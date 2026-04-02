import { submitForm } from './actions'

export default function Home() {
  return (
    <main>
      <h1>logscope + Next.js</h1>
      <p>
        This example demonstrates <code>@logscope/next</code> with route
        handlers and server actions.
      </p>

      <h2>Route Handlers</h2>
      <p>Exercise these with curl (see terminal output for wide events):</p>
      <ul>
        <li>
          <code>GET /api/users/42</code> — scope with user context
        </li>
        <li>
          <code>POST /api/users</code> — request body on scope
        </li>
        <li>
          <code>GET /api/error</code> — error capture
        </li>
      </ul>

      <h2>Server Action</h2>
      <p>Submit the form below to trigger a server action with logscope:</p>

      <form action={submitForm} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 320 }}>
        <label>
          Name
          <input type="text" name="name" defaultValue="Alice" required style={{ display: 'block', width: '100%', padding: '0.25rem' }} />
        </label>
        <label>
          Email
          <input type="email" name="email" defaultValue="alice@example.com" required style={{ display: 'block', width: '100%', padding: '0.25rem' }} />
        </label>
        <button type="submit" style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>
          Submit
        </button>
      </form>
    </main>
  )
}
