"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import styles from "./billguarded-receptionist.module.css";

function textOf(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function prompts(pathname: string): string[] {
  if (pathname === "/demo") return ["Walk me through this demo", "What is synthetic here?", "What happens next?"];
  if (pathname.startsWith("/start")) return ["Which audit fits?", "What files are supported?", "Why did validation fail?"];
  return ["What does BillGuarded do?", "Show me the audit demo", "What does it cost?"];
}

export function BillGuardedReceptionist() {
  const pathname = usePathname();
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/reception", body: () => ({ pathname }) }), [pathname]);
  const { error, messages, sendMessage, setMessages, status, stop } = useChat({ transport });
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  async function ask(value: string) {
    const text = value.trim();
    if (!text || busy) return;
    setInput("");
    await sendMessage({ text });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  const transcript = messages.slice(-8).map((m) => `${m.role === "user" ? "Visitor" : "BillGuarded"}: ${textOf(m)}`).join("\n\n").slice(0, 3500);
  const mail = `mailto:support@billguarded.com?subject=${encodeURIComponent("BillGuarded Guide follow-up")}&body=${encodeURIComponent(`I need human help with BillGuarded.\n\nPage: ${pathname}\n\nConversation summary:\n${transcript || "No messages yet."}`)}`;

  if (!open) return <button type="button" className={styles.launcher} aria-label="Open BillGuarded AI receptionist" aria-haspopup="dialog" onClick={() => setOpen(true)}>Ask BillGuarded</button>;

  return (
    <section className={styles.dialog} role="dialog" aria-modal="false" aria-label="BillGuarded AI receptionist">
      <header className={styles.header}>
        <div><strong>BillGuarded Guide</strong><span>AI receptionist · fit, demos, and audit guidance</span></div>
        <div className={styles.actions}>
          <button type="button" aria-label="Start a new conversation" onClick={() => { stop(); setMessages([]); setInput(""); }}>↻</button>
          <button ref={closeRef} type="button" aria-label="Close BillGuarded Guide" onClick={() => setOpen(false)}>×</button>
        </div>
      </header>
      <div className={styles.log} role="log" aria-live="polite" aria-relevant="additions text">
        <p className={styles.bot}>Ask about fit, supported CSVs, pricing, the synthetic demo, intake, privacy, billing routes, or troubleshooting. I cannot inspect documents or perform actions in chat.</p>
        {messages.map((message) => {
          const text = textOf(message);
          return text ? <p key={message.id} className={message.role === "user" ? styles.user : styles.bot}>{text}</p> : null;
        })}
        {status === "submitted" ? <p className={styles.bot}>Checking the approved BillGuarded guidance…</p> : null}
        {error ? <p className={styles.error} role="alert">I could not complete that answer. No upload, audit, or payment changed. Try again or use human help.</p> : null}
      </div>
      <div className={styles.composer}>
        <div className={styles.prompts} aria-label="Suggested questions">
          {prompts(pathname).map((prompt) => <button key={prompt} type="button" disabled={busy} onClick={() => void ask(prompt)}>{prompt}</button>)}
        </div>
        <form onSubmit={submit} className={styles.form}>
          <label htmlFor="billguarded-guide-input">Ask BillGuarded</label>
          <textarea id="billguarded-guide-input" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }} maxLength={1200} rows={2} placeholder="Ask a question or describe what you need…" />
          {busy ? <button type="button" onClick={stop} aria-label="Stop response">Stop</button> : <button type="submit" disabled={!input.trim()} aria-label="Send message">Send</button>}
        </form>
        <div className={styles.footer}><span>AI can make mistakes. Never paste invoice rows or payment details here.</span><a href={mail}>Human help</a></div>
      </div>
    </section>
  );
}
