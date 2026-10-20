import { useEffect, useRef, useState } from 'react';
import { get, post, timeAgo } from '../lib/api.js';
import { useApp } from '../AppContext.jsx';
import { SendIcon } from './Icons.jsx';

// Small chat for a borrow / favour / giveaway. Polls every 5 seconds while open.
export default function Chat({ base, open = true, title = 'Chat' }) {
  const { user, showToast } = useApp();
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const lastId = useRef(0);
  const box = useRef(null);

  const merge = (list) => {
    if (!list?.length) return;
    setMsgs((m) => {
      const seen = new Set(m.map((x) => x.id));
      return [...m, ...list.filter((x) => !seen.has(x.id))];
    });
    lastId.current = Math.max(lastId.current, ...list.map((x) => x.id));
  };

  useEffect(() => {
    setMsgs([]);
    lastId.current = 0;
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await get(`${base}/messages?after=${lastId.current}`);
        if (!stop) merge(r.messages);
      } catch { /* ignore polling errors */ }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [base]);

  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const r = await post(`${base}/messages`, { body, after: lastId.current });
      merge(r.messages);
      setText('');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card chat">
      <div className="chat-head"><h3>{title}</h3><span className="muted small">No phone numbers needed</span></div>
      <div className="chat-msgs" ref={box}>
        {msgs.length === 0 && <p className="muted small center">No messages yet.</p>}
        {msgs.map((m) => (m.is_system ? (
          <div key={m.id} className="chat-sys">{m.body}<span>{timeAgo(m.created_at)}</span></div>
        ) : (
          <div key={m.id} className={`chat-msg ${m.sender_id === user.id ? 'me' : ''}`}>
            {m.sender_id !== user.id && <span className="chat-name">{m.sender_name}</span>}
            <p>{m.body}</p>
            <span className="chat-time">{timeAgo(m.created_at)}</span>
          </div>
        )))}
      </div>
      {open ? (
        <form className="chat-form" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" maxLength={1000} />
          <button className="btn btn-primary btn-icon" disabled={sending || !text.trim()} aria-label="Send"><SendIcon size={18} /></button>
        </form>
      ) : <p className="muted small center chat-closed">This chat is closed.</p>}
    </section>
  );
}
