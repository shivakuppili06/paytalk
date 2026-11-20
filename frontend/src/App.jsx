import { useState, useRef, useEffect } from 'react'

const SESSION_ID = 'demo-session'

export default function App() {
  const [messages, setMessages] = useState([
    { role: 'agent', text: "Hi! I'm PayTalk. Try: \"pay Raj ₹500 for lunch\"" },
  ])
  const [input, setInput] = useState('')
  const [transactions, setTransactions] = useState([])
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchTransactions = async () => {
    try {
      const res = await fetch('/api/transactions')
      const data = await res.json()
      setTransactions(data)
    } catch (e) {
      console.error('Failed to fetch transactions', e)
    }
  }

  useEffect(() => {
    fetchTransactions()
  }, [])

  const sendMessage = async () => {
    if (!input.trim()) return
    const userMsg = { role: 'user', text: input }
    setMessages((m) => [...m, userMsg])
    setInput('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.text, session_id: SESSION_ID }),
      })
      const data = await res.json()
      setMessages((m) => [...m, { role: 'agent', text: data.reply }])
      if (data.transaction) fetchTransactions()
    } catch (e) {
      setMessages((m) => [...m, { role: 'agent', text: 'Error reaching backend. Is the backend server running on port 5000?' }])
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') sendMessage()
  }

  return (
    <div style={styles.page}>
      <div style={styles.chatCol}>
        <h1 style={styles.title}>💬 PayTalk</h1>
        <div style={styles.chatBox}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                ...styles.bubble,
                ...(m.role === 'user' ? styles.userBubble : styles.agentBubble),
              }}
            >
              {m.text}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div style={styles.inputRow}>
          <input
            style={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a payment request..."
          />
          <button style={styles.button} onClick={sendMessage}>Send</button>
        </div>
      </div>

      <div style={styles.historyCol}>
        <h2 style={styles.subtitle}>Transaction History</h2>
        {transactions.length === 0 && <p style={{ color: '#888' }}>No transactions yet.</p>}
        {transactions.slice().reverse().map((t) => (
          <div key={t.id} style={styles.txnCard}>
            <div><strong>₹{t.amount}</strong> → {t.payees.join(', ')}</div>
            <div style={{ fontSize: 12, color: '#666' }}>{t.note}</div>
            <div style={{ fontSize: 11, color: '#999' }}>{t.id} · {t.status}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles = {
  page: { display: 'flex', gap: 24, maxWidth: 900, margin: '40px auto', fontFamily: 'system-ui, sans-serif' },
  chatCol: { flex: 2 },
  historyCol: { flex: 1, borderLeft: '1px solid #eee', paddingLeft: 20 },
  title: { fontSize: 24, marginBottom: 12 },
  subtitle: { fontSize: 16, marginBottom: 12 },
  chatBox: { border: '1px solid #ddd', borderRadius: 8, padding: 16, height: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
  bubble: { padding: '8px 12px', borderRadius: 12, maxWidth: '80%' },
  userBubble: { alignSelf: 'flex-end', background: '#2563eb', color: 'white' },
  agentBubble: { alignSelf: 'flex-start', background: '#f1f5f9', color: '#111' },
  inputRow: { display: 'flex', gap: 8, marginTop: 12 },
  input: { flex: 1, padding: 10, borderRadius: 6, border: '1px solid #ccc' },
  button: { padding: '10px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: 'white', cursor: 'pointer' },
  txnCard: { border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 8 },
}
