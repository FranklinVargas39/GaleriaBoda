import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, TouchEvent } from 'react'

/* ============================ CONFIGURACIÓN ============================ */
// URL del Apps Script (…/exec). La carpeta de Drive va en FOLDER_ID dentro de Code.gs.
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXhnyzB_PubY2Uoplmg8JByaF5bwUZDhdH80DADlLmG92LLmrUtZfc1k8U6g44tGhGLQ/exec'
const NAME_1 = 'Erick Ariel'
const NAME_2 = 'Susana Yovana'
const MAX_VIDEO_MB = 100
const MAX_VIDEO_SECONDS = 30
const FALLBACK_MAX_MB = 20

/* ================================ TIPOS ================================ */
type DriveFile = { id: string; name: string; mimeType: string; createdTime: string; thumbnailLink?: string }
type Upload = { id: number; progress: number; status: 'subiendo' | 'listo' | 'error' }
type Res = { ok: boolean; error?: string; detail?: string; files?: DriveFile[]; next?: string | null; session?: string; id?: string }
type Filter = 'todo' | 'foto' | 'video'
type Pending = { file: File; url: string; css: string; fixed: boolean }

const CONFIGURED = /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[^/]+\/exec/.test(SCRIPT_URL)
const SETUP_MESSAGE = 'Falta la URL de tu Apps Script en SCRIPT_URL (src/App.tsx). Debe terminar en /exec.'

/* ============================ FILTROS (estilo IG) ============================ */
const FILTERS = [
  { id: 'normal', name: 'Normal', css: 'none' },
  { id: 'clarendon', name: 'Clarendon', css: 'contrast(1.2) saturate(1.35)' },
  { id: 'gingham', name: 'Gingham', css: 'brightness(1.05) hue-rotate(-10deg) sepia(0.1)' },
  { id: 'moon', name: 'Moon', css: 'grayscale(1) contrast(1.1) brightness(1.1)' },
  { id: 'lark', name: 'Lark', css: 'contrast(0.9) brightness(1.1) saturate(1.25)' },
  { id: 'reyes', name: 'Reyes', css: 'sepia(0.22) brightness(1.1) contrast(0.85) saturate(0.75)' },
  { id: 'juno', name: 'Juno', css: 'saturate(1.4) contrast(1.1) sepia(0.1)' },
  { id: 'dorado', name: 'Dorado', css: 'sepia(0.35) saturate(1.3) brightness(1.05)' },
  { id: 'vintage', name: 'Vintage', css: 'sepia(0.5) contrast(0.9) brightness(1.05) saturate(0.85)' },
  { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.4) brightness(0.95)' },
]

/* ============================ ICONOS (SVG) ============================ */
const P: Record<string, string> = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 9.500a3.500 3.500 0 1 0 0 7 3.500 3.500 0 0 0 0-7z',
  flip: 'M4 12a8 8 0 0 1 14-5l2 2M20 4v5h-5M20 12a8 8 0 0 1-14 5l-2-2M4 20v-5h5',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
  heart: 'M12 20s-8-5-8-11a4.500 4.500 0 0 1 8-2.500A4.500 4.500 0 0 1 20 9c0 6-8 11-8 11z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  close: 'M5 5l14 14M19 5L5 19',
  plus: 'M12 4v16M4 12h16',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20c0-4 4-6 8-6s8 2 8 6',
  refresh: 'M20 12a8 8 0 1 1-3-6.200M20 4v5h-5',
  back: 'M15 5l-7 7 7 7',
  play: 'M8 5v14l11-7z',
  sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
  share: 'M12 16V4M7 9l5-5 5 5M5 14v6h14v-6',
}
function Icon({ n, s = 24, fill = false }: { n: string; s?: number; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={s} height={s} fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[n]} />
    </svg>
  )
}

/* ====================== COMUNICACIÓN CON DRIVE (Apps Script) ====================== */
async function readJson(r: Response): Promise<Res> {
  try {
    return JSON.parse(await r.text()) as Res
  } catch {
    throw new Error('SCRIPT_NO_PUBLICO')
  }
}
async function listFiles(pageToken?: string, fresh = false) {
  const u = new URL(SCRIPT_URL)
  if (pageToken) u.searchParams.set('pageToken', pageToken)
  if (fresh) u.searchParams.set('nocache', String(Date.now()))
  return readJson(await fetch(u.toString()))
}
async function post(body: object) {
  return readJson(await fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }))
}
function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
    fr.onerror = () => reject(new Error('No se pudo leer el archivo'))
    fr.readAsDataURL(file)
  })
}

/** Sube el archivo en trozos pasando por el script (evita el 403 de la subida directa desde el navegador) */
async function sendChunks(session: string, file: File, onProgress: (p: number) => void): Promise<void> {
  const CH = 2 * 1024 * 1024
  for (let start = 0; start < file.size; start += CH) {
    const end = Math.min(start + CH, file.size)
    const r = await post({ action: 'chunk', session, start, end, total: file.size, mime: file.type, data: await toBase64(file.slice(start, end)) })
    if (!r.ok) throw new Error(r.error === 'accion' ? 'SCRIPT_VIEJO' : `Drive respondió: ${r.detail ?? r.error ?? 'error'}`)
    onProgress(Math.max(5, Math.round((end / file.size) * 100)))
  }
}

async function uploadOne(file: File, uploader: string, onProgress: (p: number) => void) {
  const meta = { name: file.name, mime: file.type, uploader }
  const init = await post({ action: 'init', ...meta, size: file.size })
  if (init.error === 'tamano') throw new Error('El archivo es demasiado pesado')
  if (init.error === 'tipo') throw new Error('Solo se aceptan fotos y videos')
  let failure = init.ok && init.session ? '' : `El script respondió: ${init.detail ?? init.error ?? 'error desconocido'}`
  if (!failure) {
    try {
      await sendChunks(init.session as string, file, onProgress)
      return
    } catch (err) {
      failure = err instanceof Error ? err.message : 'error desconocido'
    }
  }
  if (file.size > FALLBACK_MAX_MB * 1024 * 1024) throw new Error(failure || 'No se pudo subir este archivo.')
  console.warn('Subida por trozos falló:', failure)
  onProgress(15)
  const r = await post({ action: 'upload', ...meta, data: await toBase64(file) })
  if (!r.ok) throw new Error(r.error === 'tamano' ? 'El archivo es demasiado pesado' : r.error === 'accion' ? 'SCRIPT_VIEJO' : `No se pudo guardar en Drive: ${r.detail ?? r.error ?? failure}`)
  onProgress(100)
}

/** Redimensiona a 1600 px y hornea el filtro elegido en la imagen final */
async function prepareImage(file: File, css: string): Promise<File> {
  if (!file.type.startsWith('image/') || (file.type === 'image/gif' && css === 'none')) return file
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    const ctx = c.getContext('2d')!
    ctx.filter = css
    ctx.drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85))
    if (!blob || (css === 'none' && blob.size >= file.size)) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

function explain(err: unknown): string {
  if (!CONFIGURED) return SETUP_MESSAGE
  if (err instanceof Error) {
    if (err.message === 'SCRIPT_VIEJO') return 'El script publicado está desactualizado. Pega el Code.gs nuevo en Apps Script y publica una Nueva versión de la implementación.'
    if (err.message === 'SCRIPT_NO_PUBLICO') return 'El script no respondió como se esperaba. Publícalo como "Aplicación web" con acceso "Cualquier persona" y crea una nueva versión.'
    if (err instanceof TypeError) return 'No se pudo conectar. Revisa tu internet o que el script esté publicado con acceso "Cualquier persona".'
    return err.message
  }
  return 'Ocurrió un error inesperado.'
}

const driveThumb = (id: string, w = 400) => `https://drive.google.com/thumbnail?id=${id}&sz=w${w}`
/** Prefiere la miniatura que entrega la API de Drive (no depende de que el archivo sea público) */
const thumb = (f: DriveFile, w = 400) => (f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+.*$/, `=w${w}`) : driveThumb(f.id, w))
const uploaderOf = (name: string) => {
  const who = name.split('_')[1] ?? ''
  return who && who !== 'invitado' ? who : ''
}
const dateOf = (iso: string) => new Date(iso).toLocaleDateString('es-BO', { day: 'numeric', month: 'long' })
const initial = (s: string) => (s.trim()[0] ?? 'I').toUpperCase()

function burst() {
  for (let i = 0; i < 8; i++) {
    const el = document.createElement('span')
    el.className = 'heart-burst'
    el.style.left = `${window.innerWidth / 2}px`
    el.style.top = `${window.innerHeight * 0.6}px`
    el.style.fontSize = `${16 + Math.random() * 14}px`
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 240}px`)
    el.style.setProperty('--dy', `${-60 - Math.random() * 200}px`)
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 1200)
  }
}

function Avatar({ label, size = 32 }: { label: string; size?: number }) {
  return (
    <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-gold via-wine to-ink p-[2px]">
      <span className="flex h-full w-full items-center justify-center rounded-full bg-white text-xs font-semibold text-ink">{label}</span>
    </span>
  )
}

/* ============================ CÁMARA ============================ */
type CameraProps = {
  name: string
  status: { active: number; progress: number; saved: boolean; error: string; clear: () => void }
  count: number
  onShot: (f: File, css?: string) => void
  onPick: () => void
  onNative: (kind: 'foto' | 'video') => void
  onName: () => void
  onGallery: () => void
}

function CameraScreen({ name, status, count, onShot, onPick, onNative, onName, onGallery }: CameraProps) {
  const videoEl = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const [mode, setMode] = useState<'foto' | 'video'>('foto')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState('')
  const [rec, setRec] = useState(false)
  const [secs, setSecs] = useState(0)
  const [flt, setFlt] = useState(FILTERS[0])
  const [frame, setFrame] = useState('')
  const [fltOpen, setFltOpen] = useState(false)
  const [flash, setFlash] = useState(false)

  /** Captura un cuadro de la cámara para mostrar cada filtro sobre tu propia imagen */
  const grabFrame = useCallback(() => {
    const v = videoEl.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = 96
    c.height = 96
    const side = Math.min(v.videoWidth, v.videoHeight)
    c.getContext('2d')!.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, 96, 96)
    setFrame(c.toDataURL('image/jpeg', 0.6))
  }, [])

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      setError('')
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (!navigator.mediaDevices?.getUserMedia) return setError('Este navegador no permite abrir la cámara aquí.')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: mode === 'video',
        })
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        if (videoEl.current) {
          videoEl.current.srcObject = stream
          void videoEl.current.play().catch(() => undefined)
          setTimeout(grabFrame, 900)
        }
      } catch (err) {
        const n = err instanceof DOMException ? err.name : ''
        setError(n === 'NotAllowedError' ? 'No diste permiso para usar la cámara. Actívalo en tu navegador o usa las opciones de abajo.' : n === 'NotFoundError' ? 'No se encontró una cámara en este dispositivo.' : 'No se pudo abrir la cámara.')
      }
    }
    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [facing, mode, grabFrame])

  useEffect(() => {
    if (!rec) return
    const t = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [rec])

  const stopRec = useCallback(() => {
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop()
    setRec(false)
  }, [])

  useEffect(() => {
    if (rec && secs >= MAX_VIDEO_SECONDS) stopRec()
  }, [rec, secs, stopRec])

  const snap = () => {
    const v = videoEl.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d')!
    if (facing === 'user') {
      ctx.translate(c.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(v, 0, 0)
    setFlash(true)
    setTimeout(() => setFlash(false), 120)
    c.toBlob((b) => b && (navigator.vibrate?.(30), onShot(new File([b], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' }), flt.css)), 'image/jpeg', 0.92)
  }

  const startRec = () => {
    const stream = streamRef.current
    if (!stream || typeof MediaRecorder === 'undefined') return setError('Este navegador no puede grabar video aquí. Usa la opción "Grabar video".')
    const type = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
    const r = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 3_000_000 })
    chunks.current = []
    r.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data)
    r.onstop = () => {
      const t = (r.mimeType || type || 'video/webm').split(';')[0]
      const blob = new Blob(chunks.current, { type: t })
      if (blob.size) onShot(new File([blob], `video-${Date.now()}.${t.includes('mp4') ? 'mp4' : 'webm'}`, { type: t }))
    }
    r.start(1000)
    recRef.current = r
    setSecs(0)
    setRec(true)
  }

  const pill = 'flex max-w-[70vw] items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium backdrop-blur-md'
  const glass = 'bg-white/15 backdrop-blur-md ring-1 ring-white/20'
  const R = 44
  const circ = 2 * Math.PI * R

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      <video ref={videoEl} playsInline muted autoPlay onClick={() => setFltOpen(false)} style={{ filter: mode === 'foto' ? flt.css : 'none' }} className={`absolute inset-0 h-full w-full object-cover transition ${facing === 'user' ? '-scale-x-100' : ''}`} />
      {flash && <div className="absolute inset-0 z-30 bg-white/80" />}

      {/* Barra superior */}
      <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/55 to-transparent px-4 pb-14 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-2">
          <button onClick={onName} className={`flex min-w-0 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm ${glass}`}>
            <Avatar label={initial(name)} size={28} />
            <span className="truncate">{name || 'Tu nombre'}</span>
          </button>
          <button onClick={() => { stopRec(); onGallery() }} className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${glass}`}>
            <Icon n="grid" s={18} /> Galería{count > 0 ? ` · ${count}${count >= 40 ? '+' : ''}` : ''}
          </button>
        </div>
        <div className="mt-3 flex justify-center">
          {rec ? (
            <span className={`${pill} bg-red-600`}><span className="h-2 w-2 animate-pulse rounded-full bg-white" />{secs}s / {MAX_VIDEO_SECONDS}s</span>
          ) : status.error ? (
            <button onClick={status.clear} className={`${pill} bg-red-600/90 text-left`}><span className="line-clamp-2">{status.error}</span><Icon n="close" s={16} /></button>
          ) : status.active > 0 ? (
            <span className={`${pill} bg-black/50`}><span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />Publicando {status.progress}%</span>
          ) : status.saved ? (
            <span className={`${pill} animate-pop bg-white text-black`}>Publicado en la galería</span>
          ) : (
            <p className="font-script text-2xl drop-shadow">{NAME_1.split(' ')[0]} & {NAME_2.split(' ')[0]}</p>
          )}
        </div>
      </div>

      {error && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-6 bg-ink px-6 pb-56 pt-28 text-center">
          <p className="max-w-xs text-sm leading-relaxed text-white/80">{error}</p>
          <div className="grid w-full max-w-xs gap-3">
            <button onClick={() => onNative('foto')} className="rounded-xl bg-white py-3.5 text-sm font-semibold text-black active:scale-95">Tomar foto</button>
            <button onClick={() => onNative('video')} className="rounded-xl bg-white/15 py-3.5 text-sm font-semibold active:scale-95">Grabar video</button>
            <button onClick={onPick} className="rounded-xl border border-white/30 py-3.5 text-sm font-semibold active:scale-95">Elegir de mi galería</button>
          </div>
        </div>
      )}

      {/* Controles translúcidos sobre la cámara */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/25 to-transparent pb-[max(1rem,env(safe-area-inset-bottom))] pt-24">
        {mode === 'foto' && !rec && fltOpen && (
          <div className="animate-slide mx-4 mb-4 rounded-3xl bg-black/45 p-3 ring-1 ring-white/15 backdrop-blur-xl">
            <div className="grid grid-cols-5 gap-x-2 gap-y-3">
              {FILTERS.map((x) => {
                const on = flt.id === x.id
                return (
                  <button key={x.id} aria-label={`Filtro ${x.name}`} onClick={() => setFlt(x)} className="flex flex-col items-center gap-1">
                    <span className={`block h-11 w-11 overflow-hidden rounded-full transition duration-300 ${on ? 'scale-110 ring-2 ring-white' : 'ring-1 ring-white/40'}`}>
                      {frame ? <img src={frame} alt="" style={{ filter: x.css }} className="h-full w-full object-cover" /> : <span style={{ filter: x.css }} className="block h-full w-full bg-gradient-to-br from-gold-soft to-wine" />}
                    </span>
                    <span className={`text-[10px] ${on ? 'font-semibold text-white' : 'text-white/65'}`}>{x.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 items-center px-6">
          <div className="flex items-center gap-3">
            <button onClick={onPick} aria-label="Subir desde la galería" className={`flex h-12 w-12 items-center justify-center rounded-2xl active:scale-90 ${glass}`}><Icon n="image" /></button>
            {mode === 'foto' && (
              <button onClick={() => setFltOpen((o) => !o)} aria-label="Filtros" aria-pressed={fltOpen} className={`flex h-12 w-12 items-center justify-center rounded-2xl transition active:scale-90 ${fltOpen || flt.id !== 'normal' ? 'bg-white text-black' : glass}`}><Icon n="sliders" /></button>
            )}
          </div>

          <div className="relative flex h-24 w-24 items-center justify-center justify-self-center">
            {rec && (
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 96 96" aria-hidden>
                <circle cx="48" cy="48" r={R} fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="4" />
                <circle cx="48" cy="48" r={R} fill="none" stroke="#ef4444" strokeWidth="4" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - secs / MAX_VIDEO_SECONDS)} className="transition-[stroke-dashoffset] duration-1000 ease-linear" />
              </svg>
            )}
            <button
              onClick={mode === 'foto' ? snap : rec ? stopRec : startRec}
              disabled={Boolean(error)}
              aria-label={mode === 'foto' ? 'Tomar foto' : rec ? 'Detener grabación' : 'Empezar a grabar'}
              className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white/90 bg-white/10 backdrop-blur-sm transition active:scale-90 disabled:opacity-30"
            >
              {mode === 'foto' ? <span className="h-14 w-14 rounded-full bg-white" /> : rec ? <span className="h-7 w-7 rounded-md bg-red-600" /> : <span className="h-14 w-14 rounded-full bg-red-600" />}
            </button>
          </div>

          <button onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} disabled={rec} aria-label="Cambiar de cámara" className={`flex h-12 w-12 items-center justify-center justify-self-end rounded-2xl active:scale-90 disabled:opacity-40 ${glass}`}><Icon n="flip" /></button>
        </div>

        <div className="mt-4 flex justify-center gap-8 text-xs font-semibold uppercase tracking-[0.25em]">
          {(['foto', 'video'] as const).map((m) => (
            <button key={m} disabled={rec} onClick={() => { setMode(m); setFltOpen(false) }} className={`pb-1 transition disabled:opacity-40 ${mode === m ? 'border-b-2 border-white text-white' : 'border-b-2 border-transparent text-white/60'}`}>
              {m === 'foto' ? 'Foto' : 'Video'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ============================ EDITOR (filtros) ============================ */
function Editor({ pending, onCancel, onShare }: { pending: Pending; onCancel: () => void; onShare: (css: string) => void }) {
  const [f, setF] = useState(FILTERS.find((x) => x.css === pending.css) ?? FILTERS[0])
  const isVideo = pending.file.type.startsWith('video/')
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button onClick={onCancel} aria-label="Descartar" className="p-1"><Icon n="close" /></button>
        <p className="text-sm font-semibold">Nueva publicación</p>
        <button onClick={() => onShare(f.css)} className="text-sm font-semibold text-sky-400">Compartir</button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        {isVideo ? (
          <video src={pending.url} controls playsInline autoPlay muted loop className="max-h-full max-w-full" />
        ) : (
          <img src={pending.url} alt="" style={{ filter: f.css }} className="max-h-full max-w-full object-contain transition" />
        )}
      </div>
      {!isVideo && !pending.fixed ? (
        <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {FILTERS.map((x) => (
            <button key={x.id} onClick={() => setF(x)} className="shrink-0 text-center">
              <img src={pending.url} alt="" style={{ filter: x.css }} className={`h-20 w-20 rounded-md object-cover ${f.id === x.id ? 'ring-2 ring-white' : 'opacity-80'}`} />
              <span className={`mt-1.5 block text-[11px] ${f.id === x.id ? 'font-semibold text-white' : 'text-white/60'}`}>{x.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-center text-xs text-white/60">{isVideo ? 'Los filtros están disponibles para fotos.' : `Filtro aplicado: ${f.name}`}</p>
      )}
    </div>
  )
}

/* ============================ GALERÍA ============================ */
type GalleryProps = { files: DriveFile[]; next: string | null; loading: boolean; problem: string; onRefresh: () => void; onMore: () => void; onBack: () => void }

const RATIOS = ['aspect-[4/5]', 'aspect-square', 'aspect-[3/4]', 'aspect-[5/6]']
const TILTS = ['-rotate-[1.2deg]', 'rotate-[1deg]', 'rotate-[0.6deg]', '-rotate-[0.8deg]']

function Petals() {
  const items = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ i, left: Math.random() * 100, dur: 12 + Math.random() * 10, delay: -Math.random() * 20, w: 8 + Math.random() * 9, drift: (Math.random() - 0.5) * 180 })), [])
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      {items.map((p) => (
        <span key={p.i} className="petal" style={{ left: `${p.left}%`, width: p.w, height: p.w * 1.3, background: p.i % 3 === 0 ? '#e9b8bf' : '#f4dfe1', '--dur': `${p.dur}s`, '--delay': `${p.delay}s`, '--drift': `${p.drift}px` } as CSSProperties} />
      ))}
    </div>
  )
}

function Ornament() {
  return (
    <div className="my-4 flex items-center justify-center gap-3 text-gold" aria-hidden>
      <span className="h-px w-16 bg-gradient-to-r from-transparent to-gold" />
      <span className="text-[10px]">◆</span>
      <Icon n="heart" s={18} fill />
      <span className="text-[10px]">◆</span>
      <span className="h-px w-16 bg-gradient-to-l from-transparent to-gold" />
    </div>
  )
}

function GalleryScreen({ files, next, loading, problem, onRefresh, onMore, onBack }: GalleryProps) {
  const [filter, setFilter] = useState<Filter>('todo')
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const [liked, setLiked] = useState<Set<string>>(new Set())
  const [broken, setBroken] = useState(false)
  const [toast, setToast] = useState('')
  const touchX = useRef(0)

  /** Si una miniatura falla, reintenta con la otra dirección de Drive; si vuelve a fallar, avisa */
  const onBroken = (im: HTMLImageElement, id: string) => {
    if (!im.dataset.fb) {
      im.dataset.fb = '1'
      im.src = driveThumb(id, 600)
      return
    }
    im.style.visibility = 'hidden'
    setBroken(true)
  }

  const shown = useMemo(() => files.filter((f) => (filter === 'todo' ? true : filter === 'video' ? f.mimeType.startsWith('video/') : f.mimeType.startsWith('image/'))), [files, filter])
  const go = useCallback((d: number) => setOpenIdx((i) => (i === null || !shown.length ? i : (i + d + shown.length) % shown.length)), [shown.length])

  useEffect(() => {
    if (openIdx === null) return
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' ? setOpenIdx(null) : e.key === 'ArrowRight' ? go(1) : e.key === 'ArrowLeft' ? go(-1) : undefined)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openIdx, go])

  const onTouchEnd = (e: TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchX.current
    if (Math.abs(dx) >= 50) go(dx < 0 ? 1 : -1)
  }
  const toggleLike = (id: string) =>
    setLiked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else {
        n.add(id)
        burst()
      }
      return n
    })

  const current = openIdx !== null ? shown[openIdx] : null
  const tabs: { id: Filter; label: string }[] = [{ id: 'todo', label: 'Todos' }, { id: 'foto', label: 'Fotos' }, { id: 'video', label: 'Videos' }]
  const n1 = NAME_1.split(' ')[0]
  const n2 = NAME_2.split(' ')[0]

  const say = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(''), 2200)
  }
  /** Abre el menú de compartir del celular; si no existe, copia el enlace */
  const share = async (f: DriveFile) => {
    const url = `https://drive.google.com/file/d/${f.id}/view`
    try {
      if (navigator.share) {
        await navigator.share({ title: `Recuerdo de la boda de ${n1} y ${n2}`, text: `Mira este recuerdo de la boda de ${n1} y ${n2}`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      say('Enlace copiado')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      say('No se pudo compartir')
    }
  }

  return (
    <div className="paper-dark relative min-h-screen pb-32 font-display text-ivory">
      <Petals />
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-gold/30 bg-black/60 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-md">
        <button onClick={onBack} aria-label="Volver a la cámara" className="p-1 text-gold-soft"><Icon n="back" /></button>
        <p className="font-script text-2xl text-gold-soft">{n1} & {n2}</p>
        <button onClick={onRefresh} disabled={loading} aria-label="Actualizar" className="p-1 text-gold-soft disabled:opacity-40"><span className={loading ? 'inline-block animate-spin' : 'inline-block'}><Icon n="refresh" /></span></button>
      </header>

      <section className="relative z-10 mx-auto max-w-4xl px-4">
        <div className="rise pb-6 pt-12 text-center">
          <p className="font-body text-[11px] uppercase tracking-[0.45em] text-gold">Recuerdos de nuestra boda</p>
          <h1 className="gold-text mt-4 font-script text-6xl leading-tight sm:text-8xl">{n1} & {n2}</h1>
          <Ornament />
          <p className="text-lg italic text-ivory/65">{files.length > 0 ? `${files.length}${next ? '+' : ''} momentos compartidos por quienes nos acompañaron` : 'Los momentos de todos, en un solo lugar'}</p>
        </div>

        <div className="mb-8 flex justify-center">
          <div className="inline-flex rounded-full border border-gold/50 bg-white/5 p-1 shadow-sm backdrop-blur">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setFilter(t.id)} className={`rounded-full px-5 py-1.5 text-base transition duration-300 ${filter === t.id ? 'bg-wine text-ivory shadow' : 'text-ivory/70 hover:text-gold-soft'}`}>{t.label}</button>
            ))}
          </div>
        </div>

        {problem && <div role="alert" className="mx-auto mb-6 max-w-xl rounded-xl border border-wine/20 bg-wine/10 px-5 py-4 text-center font-body text-sm text-wine">{problem}</div>}

        {broken && <div role="status" className="mx-auto mb-6 max-w-xl rounded-xl border border-gold/30 bg-white/5 px-5 py-4 text-center font-body text-sm leading-relaxed text-ivory/80">Algunas fotos no se pueden mostrar todavía. Revisa que la carpeta de Drive esté compartida como "Cualquier persona con el enlace" y vuelve a actualizar.</div>}

        <div className="columns-2 gap-4 sm:columns-3 sm:gap-6">
          {loading && files.length === 0
            ? Array.from({ length: 6 }, (_, i) => <div key={i} className={`mb-5 break-inside-avoid animate-skeleton bg-white/10 ${RATIOS[i % 4]}`} />)
            : shown.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => setOpenIdx(i)}
                  style={{ animationDelay: `${Math.min(i, 12) * 70}ms` }}
                  className={`rise group relative mb-5 block w-full break-inside-avoid bg-white p-2 pb-9 shadow-lg shadow-wine/15 transition duration-500 hover:z-10 hover:rotate-0 hover:scale-[1.04] hover:shadow-2xl ${TILTS[i % 4]}`}
                >
                  <div className={`relative overflow-hidden bg-blush ${RATIOS[(i * 3) % 4]}`}>
                    <img src={thumb(f, 600)} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-110" onError={(e) => onBroken(e.currentTarget, f.id)} />
                    <span className="absolute inset-0 bg-gradient-to-t from-wine/45 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
                    {f.mimeType.startsWith('video/') && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/70 bg-black/35 text-white backdrop-blur"><Icon n="play" s={20} fill /></span>
                      </span>
                    )}
                  </div>
                  <span className="absolute inset-x-2 bottom-1 truncate text-center font-script text-xl text-wine">{uploaderOf(f.name) || 'Invitado'}</span>
                </button>
              ))}
        </div>

        {!loading && !problem && shown.length === 0 && (
          <div className="py-16 text-center">
            <p className="font-script text-5xl text-gold-soft">Aún no hay recuerdos</p>
            <p className="mt-2 text-lg italic text-ivory/60">Sé el primero en compartir uno.</p>
          </div>
        )}

        {next && (
          <div className="mt-6 text-center">
            <button onClick={onMore} disabled={loading} className="rounded-full border border-gold px-8 py-2.5 font-body text-sm text-gold-soft transition hover:bg-gold hover:text-black disabled:opacity-50">{loading ? 'Cargando…' : 'Ver más recuerdos'}</button>
          </div>
        )}

        <div className="pb-6 pt-14 text-center">
          <Ornament />
          <p className="font-script text-3xl text-gold-soft">Con amor, {n1} y {n2}</p>
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center bg-gradient-to-t from-black via-black/80 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-8">
        <button onClick={onBack} className="pulse-ring flex items-center gap-2 rounded-full bg-gradient-to-r from-wine to-ink px-7 py-3.5 font-body text-sm font-medium tracking-wide text-ivory shadow-xl transition active:scale-95">
          <Icon n="camera" s={20} /> Compartir un recuerdo
        </button>
      </div>

      {current && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/90 p-4 backdrop-blur-md" onClick={() => setOpenIdx(null)} onTouchStart={(e) => (touchX.current = e.touches[0].clientX)} onTouchEnd={onTouchEnd}>
          <button className="absolute right-4 top-[max(0.75rem,env(safe-area-inset-top))] z-10 p-2 text-ivory" aria-label="Cerrar" onClick={() => setOpenIdx(null)}><Icon n="close" s={28} /></button>
          <button className="absolute left-3 z-10 hidden p-2 text-ivory/80 hover:text-gold sm:block" aria-label="Anterior" onClick={(e) => { e.stopPropagation(); go(-1) }}><Icon n="back" s={36} /></button>
          <div key={current.id} className="animate-pop w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
            <div className="frame bg-ivory p-3 pb-5 shadow-2xl">
              {current.mimeType.startsWith('video/') ? (
                <iframe title="Video" src={`https://drive.google.com/file/d/${current.id}/preview`} allow="autoplay; fullscreen" allowFullScreen className="aspect-video w-full border-0" />
              ) : (
                <img src={thumb(current, 1600)} alt="" onDoubleClick={() => !liked.has(current.id) && toggleLike(current.id)} className="mx-auto max-h-[62vh] w-full object-contain" />
              )}
              <div className="mt-4 text-center">
                <p className="font-script text-4xl text-wine">{uploaderOf(current.name) || 'Invitado'}</p>
                <p className="italic text-ink/55">{dateOf(current.createdTime)}</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3 font-body text-sm text-ivory">
              <button onClick={() => toggleLike(current.id)} aria-label="Me gusta" className={`transition active:scale-125 ${liked.has(current.id) ? 'text-gold' : ''}`}><Icon n="heart" s={26} fill={liked.has(current.id)} /></button>
              <button onClick={() => void share(current)} className="flex items-center gap-2 rounded-full border border-gold/70 px-5 py-2 text-gold-soft transition active:scale-95"><Icon n="share" s={18} /> Compartir</button>
              <a href={`https://drive.google.com/uc?export=download&id=${current.id}`} className="flex items-center gap-2 rounded-full border border-gold/70 px-5 py-2 text-gold-soft"><Icon n="download" s={18} /> Descargar</a>
              <span className="text-ivory/50">{(openIdx ?? 0) + 1} / {shown.length}</span>
            </div>
          </div>
          <button className="absolute right-3 z-10 hidden p-2 text-ivory/80 hover:text-gold sm:block" aria-label="Siguiente" onClick={(e) => { e.stopPropagation(); go(1) }}><span className="inline-block rotate-180"><Icon n="back" s={36} /></span></button>
          {toast && <div role="status" className="animate-pop absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-20 rounded-full bg-ivory px-5 py-2 font-body text-sm text-ink shadow-xl">{toast}</div>}
        </div>
      )}
    </div>
  )
}

/* ============================ APP ============================ */
export default function App() {
  const [view, setView] = useState<'camera' | 'gallery'>('camera')
  const [name, setName] = useState(() => localStorage.getItem('nombre') ?? '')
  const [nameOpen, setNameOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [files, setFiles] = useState<DriveFile[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState('')
  const [saved, setSaved] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const counter = useRef(0)
  const nameRef = useRef(name)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const photoRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const pickRef = useRef<HTMLInputElement>(null)
  nameRef.current = name

  const refresh = useCallback(async (fresh = false) => {
    if (!CONFIGURED) {
      setProblem(SETUP_MESSAGE)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const r = await listFiles(undefined, fresh)
      if (!r.ok) throw new Error(r.error === 'drive' ? `Drive dice: ${r.detail ?? 'sin acceso a la carpeta'}` : `El script dice: ${r.detail ?? r.error ?? 'error'}`)
      setFiles(r.files ?? [])
      setNext(r.next ?? null)
      setProblem('')
    } catch (err) {
      setProblem(explain(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMore = async () => {
    if (!next) return
    setLoading(true)
    try {
      const r = await listFiles(next)
      if (r.ok) {
        setFiles((f) => [...f, ...(r.files ?? [])])
        setNext(r.next ?? null)
      }
    } catch (err) {
      setProblem(explain(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (view === 'gallery') void refresh(true) }, [view, refresh])

  const patch = (id: number, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const processFile = async (original: File, css: string) => {
    const id = ++counter.current
    setUploads((u) => [{ id, progress: 0, status: 'subiendo' }, ...u])
    try {
      if (!CONFIGURED) throw new Error(SETUP_MESSAGE)
      if (!/^(image|video)\//.test(original.type)) throw new Error('Solo se aceptan fotos y videos')
      if (original.type.startsWith('video/') && original.size > MAX_VIDEO_MB * 1024 * 1024) throw new Error(`El video pesa más de ${MAX_VIDEO_MB} MB. Graba uno más corto (máx. ${MAX_VIDEO_SECONDS} s).`)
      const file = await prepareImage(original, css)
      await uploadOne(file, nameRef.current.trim() || 'invitado', (p) => patch(id, { progress: p }))
      patch(id, { progress: 100, status: 'listo' })
      setUploadError('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      burst()
      setTimeout(() => void refresh(true), 1500)
    } catch (err) {
      patch(id, { status: 'error' })
      setUploadError(explain(err))
    }
  }

  const enqueue = (list: File[], css = 'none') => {
    for (const f of list) queue.current = queue.current.then(() => processFile(f, css))
  }

  const review = (f: File, css?: string) => setPending({ file: f, url: URL.createObjectURL(f), css: css ?? 'none', fixed: css !== undefined })
  const closeReview = () => {
    if (pending) URL.revokeObjectURL(pending.url)
    setPending(null)
  }

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (list.length === 1) review(list[0])
    else enqueue(list)
  }

  const saveName = () => {
    const n = draft.trim()
    setName(n)
    localStorage.setItem('nombre', n)
    setNameOpen(false)
  }

  const active = uploads.filter((u) => u.status === 'subiendo')
  const status = {
    active: active.length,
    progress: active.length ? Math.round(active.reduce((s, u) => s + u.progress, 0) / active.length) : 0,
    saved,
    error: uploadError,
    clear: () => setUploadError(''),
  }

  return (
    <div className="font-body">
      <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleInput} />
      <input ref={videoRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={handleInput} />
      <input ref={pickRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleInput} />

      {!CONFIGURED && <div role="alert" className="fixed inset-x-0 bottom-0 z-[70] bg-amber-300 px-4 py-3 text-center text-sm font-medium text-black">{SETUP_MESSAGE}</div>}

      {view === 'camera' ? (
        <CameraScreen
          name={name}
          status={status}
          count={files.length}
          onShot={review}
          onPick={() => pickRef.current?.click()}
          onNative={(k) => (k === 'foto' ? photoRef : videoRef).current?.click()}
          onName={() => { setDraft(name); setNameOpen(true) }}
          onGallery={() => setView('gallery')}
        />
      ) : (
        <GalleryScreen files={files} next={next} loading={loading} problem={problem} onRefresh={() => void refresh(true)} onMore={loadMore} onBack={() => setView('camera')} />
      )}

      {pending && <Editor pending={pending} onCancel={closeReview} onShare={(css) => { enqueue([pending.file], css); closeReview() }} />}

      {nameOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center" onClick={() => setNameOpen(false)}>
          <form className="animate-slide w-full max-w-sm rounded-t-2xl bg-white p-5 text-black sm:rounded-2xl" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); saveName() }}>
            <p className="text-center text-base font-semibold">Tu nombre de usuario</p>
            <p className="mt-1 text-center text-xs text-black/55">Aparecerá en tus publicaciones (opcional).</p>
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={30} placeholder="Ej. Tía Carmen" className="mt-4 w-full rounded-lg border border-black/15 bg-black/5 px-4 py-3 text-sm outline-none focus:border-black/40" />
            <button className="mt-4 w-full rounded-lg bg-sky-500 py-2.5 text-sm font-semibold text-white">Guardar</button>
          </form>
        </div>
      )}
    </div>
  )
}