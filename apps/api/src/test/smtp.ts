import { createServer } from 'node:net'

export interface CaughtMail {
  from: string
  to: string[]
  /** The message as it went over the wire: headers, then the bodies. */
  data: string
}

/**
 * A mail server for tests: it accepts every message on this machine and keeps it, and delivers
 * nothing. Just enough SMTP for one sender, without encryption or a password. It listens on a free
 * port unless one is given.
 */
export async function startMailCatcher(listenOn = 0): Promise<{ port: number; caught: CaughtMail[]; close(): Promise<void> }> {
  const caught: CaughtMail[] = []
  const server = createServer((socket) => {
    let buffer = ''
    let inData = false
    let current: CaughtMail = { from: '', to: [], data: '' }
    socket.setEncoding('utf8')
    socket.write('220 localhost ESMTP\r\n')
    socket.on('error', () => {})
    socket.on('data', (chunk: string) => {
      buffer += chunk
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end === -1) return
          current.data = buffer.slice(0, end)
          buffer = buffer.slice(end + 5)
          caught.push(current)
          current = { from: '', to: [], data: '' }
          inData = false
          socket.write('250 OK\r\n')
          continue
        }
        const newline = buffer.indexOf('\r\n')
        if (newline === -1) return
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 2)
        const command = line.toUpperCase()
        if (command.startsWith('EHLO') || command.startsWith('HELO')) socket.write('250 localhost\r\n')
        else if (command.startsWith('MAIL FROM:')) {
          current.from = line.slice(10).replace(/[<>]/g, '').trim().split(' ')[0] ?? ''
          socket.write('250 OK\r\n')
        } else if (command.startsWith('RCPT TO:')) {
          current.to.push(line.slice(8).replace(/[<>]/g, '').trim())
          socket.write('250 OK\r\n')
        } else if (command === 'DATA') {
          inData = true
          socket.write('354 Go ahead\r\n')
        } else if (command === 'QUIT') {
          socket.end('221 Bye\r\n')
        } else if (command === 'RSET' || command === 'NOOP') socket.write('250 OK\r\n')
        // Like a real server without TLS: STARTTLS and anything else unknown is refused.
        else socket.write('502 Command not implemented\r\n')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(listenOn, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    port,
    caught,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
