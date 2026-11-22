import { useId, useState, type DragEvent, type ReactNode } from 'react'
import { inputClass } from './shared'

/** Key files are a few kilobytes; anything much larger is the wrong file. */
const MAX_BYTES = 64 * 1024

/**
 * A key that is usually downloaded as a file: drop it, choose it, or paste its contents. The
 * file is read in the browser and sent like a pasted key; nothing is uploaded on its own.
 */
export function KeyFileField(props: {
  label: string
  /** What to accept in the file picker, e.g. `.p8`. */
  accept: string
  /** The name the file usually has, shown in the drop zone. */
  fileHint: string
  pastePlaceholder: string
  value: string
  /** Called with the contents, and the file name when it came from a file. */
  onChange: (text: string, fileName: string | null) => void
  /** Why the contents cannot be the key, or null when they can. */
  check: (text: string) => string | null
  /** A line about a key that passed the check, e.g. its service account. */
  describe?: (text: string) => ReactNode
}) {
  const inputId = useId()
  const errorId = useId()
  const [fileName, setFileName] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const [dragging, setDragging] = useState(false)

  const take = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_BYTES) {
      setProblem(`${file.name} is too large to be the key file.`)
      return
    }
    const text = await file.text()
    const why = props.check(text)
    setProblem(why ? `${file.name}: ${why}` : null)
    if (why) return
    setFileName(file.name)
    props.onChange(text, file.name)
  }

  const clear = () => {
    setFileName(null)
    setProblem(null)
    props.onChange('', null)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    void take(event.dataTransfer.files[0])
  }

  const loaded = props.value !== '' && props.check(props.value) === null

  return (
    <div>
      <span className="text-sm font-medium">{props.label}</span>
      {pasting ? (
        <>
          <textarea
            aria-label={props.label}
            rows={5}
            autoComplete="off"
            spellCheck={false}
            placeholder={props.pastePlaceholder}
            value={props.value}
            onChange={(event) => {
              setFileName(null)
              const text = event.target.value
              setProblem(text.trim() === '' ? null : props.check(text))
              props.onChange(text, null)
            }}
            aria-describedby={problem ? errorId : undefined}
            className={`${inputClass} text-xs`}
          />
          <button
            type="button"
            className="mt-2 cursor-pointer text-xs font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
            onClick={() => {
              setPasting(false)
              clear()
            }}
          >
            Choose the file instead
          </button>
        </>
      ) : loaded && fileName ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-line bg-surface px-4 py-3 text-sm">
          <span className="min-w-0 break-all">
            <span className="font-medium">{fileName}</span>
            {props.describe && <span className="block text-xs text-ink-soft">{props.describe(props.value)}</span>}
          </span>
          <button
            type="button"
            className="cursor-pointer text-xs font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
            onClick={clear}
          >
            Remove
          </button>
        </div>
      ) : (
        <>
          <input
            id={inputId}
            type="file"
            accept={props.accept}
            className="peer sr-only"
            aria-describedby={problem ? errorId : undefined}
            onChange={(event) => {
              void take(event.target.files?.[0])
              // So choosing the same file again after removing it still reads it.
              event.target.value = ''
            }}
          />
          <label
            htmlFor={inputId}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`mt-2 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center text-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-views ${
              dragging ? 'border-ink bg-paper' : 'border-line bg-surface hover:border-ink-soft'
            }`}
          >
            <span className="font-medium">Drop {props.fileHint} here, or choose it</span>
            <span className="text-xs text-ink-soft">It is read in your browser and sent with the form.</span>
          </label>
          <button
            type="button"
            className="mt-2 cursor-pointer text-xs font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
            onClick={() => {
              setPasting(true)
              setProblem(null)
            }}
          >
            Paste its contents instead
          </button>
        </>
      )}
      {problem && (
        <p id={errorId} role="alert" className="mt-2 text-sm font-medium">
          {problem}
        </p>
      )}
    </div>
  )
}

/** Why text cannot be an App Store Connect `.p8` key, or null. */
export function checkP8(text: string): string | null {
  if (!/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(text)) {
    return 'this is not a private key. Use the AuthKey_….p8 file App Store Connect gave you.'
  }
  return null
}

/** The Key ID in a file name like `AuthKey_2X9R4HXF34.p8`, or null. */
export function keyIdFromFileName(fileName: string | null): string | null {
  return fileName?.match(/AuthKey_([A-Z0-9]{8,12})\.p8$/i)?.[1]?.toUpperCase() ?? null
}

type ServiceAccountKey = { type?: unknown; client_email?: unknown; private_key?: unknown }

/** Why text cannot be a Google service account JSON key, or null. */
export function checkServiceAccount(text: string): string | null {
  let key: ServiceAccountKey
  try {
    key = JSON.parse(text) as ServiceAccountKey
  } catch {
    return 'this is not a JSON key file.'
  }
  if (key.type !== 'service_account' || typeof key.client_email !== 'string' || typeof key.private_key !== 'string') {
    return 'this JSON is not a service account key. Create one under the service account, Keys, Add key, JSON.'
  }
  return null
}

/** The email a service account key belongs to; Play Console must invite this address. */
export function serviceAccountEmail(text: string): string | null {
  try {
    const email = (JSON.parse(text) as ServiceAccountKey).client_email
    return typeof email === 'string' ? email : null
  } catch {
    return null
  }
}
