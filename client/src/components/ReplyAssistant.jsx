import React, { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
function getSessionIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return sp.get("session") || "TEST123";
}
function cx(...xs){ return xs.filter(Boolean).join(" "); }

async function readJsonSafe(res) {
  const ct = res.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) { try { return await res.json(); } catch { return null; } }
  try { return JSON.parse(await res.text()); } catch { return null; }
}

async function postWithFallback(path, payload) {
  const session = getSessionIdFromUrl();
  const endpoints = [
    `${API_BASE}/api/emails${path}?session=${encodeURIComponent(session)}`,
    `${API_BASE}/api${path}?session=${encodeURIComponent(session)}`,
  ];
  let lastErr = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      if (res.status === 401) return { res, json: await readJsonSafe(res) };
      if (res.status === 404 || res.status === 405) {
        const txt = await res.clone().text().catch(()=> "");
        if (/Cannot\s+POST/i.test(txt)) { lastErr = new Error(`Endpoint not found: ${url}`); continue; }
      }
      const json = await readJsonSafe(res);
      return { res, json };
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  throw new Error("No endpoint reached");
}

function ensureReplySubject(s=""){ const t=s.trim(); if(!t) return "Re:"; return /^re:/i.test(t)?t:`Re: ${t}`; }
function quoteTextBlock(s=""){ const lines=s.replace(/\r\n/g,"\n").split("\n"); const quoted=lines.map(ln => `> ${ln}`.replace(/\s+$/,"")).join("\n"); return `\n\n---- Original message ----\n${quoted}`; }
function sanitizeAiReply(text=""){ return (text || "").replace(/^(?:\s*Subject\s*:\s*.*\n)+/i, "").replace(/^\s*\n+/, "").trimStart(); }

// Profile store
const PROFILE_KEY = "ai_inbox_profile_v1";
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch { return {}; }
}
function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {}
}

export default function ReplyAssistant({ seed, onCancel }) {
  // Envelope
  const [to, setTo] = useState(seed?.to || "");
  const [subject, setSubject] = useState(seed?.subject || "");
  const [threadId, setThreadId] = useState(seed?.threadId || "");

  // Track which message is active (for UX/debug)
  const [activeMessageId, setActiveMessageId] = useState("");

  // Content
  const [original, setOriginal] = useState("");
  const [reply, setReply] = useState("");
  const [includeQuote, setIncludeQuote] = useState(false);
  const [autoRe, setAutoRe] = useState(true);
  const [style, setStyle] = useState("professional");

  // Profile
  const initialProfile = { name: "", contact: "", useProfile: false, appendSignature: false, ...loadProfile() };
  const [profile, setProfile] = useState(initialProfile);
  const [showProfileModal, setShowProfileModal] = useState(false);
  useEffect(()=>{ saveProfile(profile); }, [profile]);

  // Refine
  const [reviseNote, setReviseNote] = useState("");

  // UI
  const [pasting, setPasting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [composeError, setComposeError] = useState("");
  const [triedSubmit, setTriedSubmit] = useState(false);

  // Refs & anchors
  const originalRef = useRef(null);
  const replyRef = useRef(null);
  const pasteOriginalBtnRef = useRef(null);
  const composeBtnRef = useRef(null);
  const containerRef = useRef(null);

  const canUseClipboard = typeof navigator !== "undefined" && !!navigator.clipboard?.readText;

  useEffect(()=>{ originalRef.current?.focus(); }, []);
  useEffect(()=>{ if (seed?.to !== undefined) setTo(seed.to); }, [seed?.to]);
  useEffect(()=>{ if (seed?.subject !== undefined) setSubject(seed.subject); }, [seed?.subject]);
  useEffect(()=>{ if (seed?.threadId !== undefined) setThreadId(seed.threadId); }, [seed?.threadId]);

  // Event bus — now includes a RESET that wipes previous content
  useEffect(() => {
    function onReset(e){
      const { messageId } = e.detail || {};
      setActiveMessageId(messageId || "");
      // wipe everything so old content can't hang around
      setOriginal("");
      setReply("");
      setResult(null);
      setError("");
      setComposeError("");
      setReviseNote("");
      setTriedSubmit(false);
      setIncludeQuote(false);
    }
    function onSeed(e){
      const s=e.detail||{};
      if(s.messageId) setActiveMessageId(s.messageId);
      if(s.to!==undefined) setTo(s.to);
      if(s.subject!==undefined) setSubject(s.subject);
      if(s.threadId!==undefined) setThreadId(s.threadId);
    }
    function onFocus(){
      containerRef.current?.scrollIntoView({ behavior:"smooth", block:"start" });
      (pasteOriginalBtnRef.current || originalRef.current)?.focus();
    }
    function onPasteText(e){
      const t=(e.detail?.text||"").trim();
      if(t){
        setOriginal(t);
        setTimeout(()=> (composeBtnRef.current || replyRef.current)?.focus(), 0);
      }
    }
    function onCompose(e){
      if(original.trim().length >= 10){ handleCompose(e?.detail?.style || style); }
      else { (pasteOriginalBtnRef.current || originalRef.current)?.focus(); }
    }
    function onClear(){
      // broaden clear to also wipe the original so stale text can’t persist
      setOriginal("");
      setReply("");
      setResult(null);
      setError("");
      setComposeError("");
    }

    window.addEventListener("reply-assistant:reset", onReset);
    window.addEventListener("reply-assistant:seed", onSeed);
    window.addEventListener("reply-assistant:focus", onFocus);
    window.addEventListener("reply-assistant:pasteText", onPasteText);
    window.addEventListener("reply-assistant:compose", onCompose);
    window.addEventListener("reply-assistant:clear", onClear);
    return () => {
      window.removeEventListener("reply-assistant:reset", onReset);
      window.removeEventListener("reply-assistant:seed", onSeed);
      window.removeEventListener("reply-assistant:focus", onFocus);
      window.removeEventListener("reply-assistant:pasteText", onPasteText);
      window.removeEventListener("reply-assistant:compose", onCompose);
      window.removeEventListener("reply-assistant:clear", onClear);
    };
  }, [original, style]);

  const errors = useMemo(() => {
    const e = {};
    if (!to.trim()) e.to = "Add at least one recipient.";
    if (!(subject || "").toString().trim()) e.subject = "Subject is required.";
    if (reply.trim().length < 5) e.reply = "Write or paste the reply (5+ chars).";
    return e;
  }, [to, subject, reply]);

  async function pasteInto(which) {
    if (!canUseClipboard) return;
    setPasting(true);
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      if (which === "original") {
        setOriginal(prev => prev ? `${prev}\n${text}` : text);
        setTimeout(()=> replyRef.current?.focus(), 0);
      } else {
        setReply(prev => prev ? `${prev}\n${text}` : text);
      }
    } finally { setPasting(false); }
  }

  function applyProfilePlaceholders(text="") {
    let t = text;
    if (profile.useProfile) {
      if (profile.name)    t = t.replace(/\[Your Name\]/gi, profile.name);
      if (profile.contact) t = t.replace(/\[Your Contact Information\]/gi, profile.contact);
    }
    t = t.replace(/^\s*\[[^\]]+\]\s*$/gm, "");
    t = t.replace(/\n{3,}/g, "\n\n");
    return t;
  }

  const signatureText = useMemo(() => {
    const parts = [profile.name, profile.contact].map(s => (s||"").trim()).filter(Boolean);
    return parts.join("\n");
  }, [profile.name, profile.contact]);

  const finalSubject = (autoRe ? ensureReplySubject(subject) : subject);
  const finalBody = useMemo(() => {
    let base = applyProfilePlaceholders(reply.trim());
    if (profile.appendSignature && signatureText) {
      base = base ? `${base}\n\n${signatureText}` : signatureText;
    }
    if (includeQuote && original.trim()) {
      base = base + quoteTextBlock(original.trim());
    }
    return base;
  }, [reply, includeQuote, original, profile.appendSignature, signatureText]);

  async function handleCompose(styleOverride) {
    setComposeError("");
    const originalText = original.trim();
    if (originalText.length < 10) { setComposeError("Paste the original message first."); return; }
    setDrafting(true);
    try {
      const { res, json } = await postWithFallback("/compose/reply", {
        original: originalText,
        subject: subject.trim(),
        to: to.trim(),
        style: styleOverride || style,
      });
      if (res.status === 401) {
        if (json?.error === "NO_SESSION") {
          window.location.href = `${API_BASE}/auth/google?session=${encodeURIComponent(getSessionIdFromUrl())}`; return;
        }
        throw new Error(json?.message || "Unauthorized");
      }
      if (!res.ok || !json?.ok || !json?.reply) throw new Error(json?.message || `Compose failed (${res.status})`);
      const cleaned = sanitizeAiReply(json.reply, subject);
      const withProfile = applyProfilePlaceholders(cleaned);
      setReply(withProfile.trim());
      setTimeout(()=> replyRef.current?.focus(), 0);
    } catch (e) { setComposeError(e.message || "Failed to compose reply."); }
    finally { setDrafting(false); }
  }

  async function handleRefine() {
    setComposeError("");
    const note = (reviseNote || "").trim();
    if (!note) { setComposeError("Add a short note telling the AI how to change the reply."); return; }
    if (original.trim().length < 10) { setComposeError("Paste the original message first."); return; }
    if (reply.trim().length < 5) { setComposeError("Draft a reply first (or write a few words)."); return; }
    setDrafting(true);
    try {
      const { res, json } = await postWithFallback("/compose/reply", {
        original: original.trim(),
        subject: subject.trim(),
        to: to.trim(),
        style,
        draft: reply.trim(),
        instructions: note,
      });
      if (res.status === 401) {
        if (json?.error === "NO_SESSION") {
          window.location.href = `${API_BASE}/auth/google?session=${encodeURIComponent(getSessionIdFromUrl())}`; return;
        }
        throw new Error(json?.message || "Unauthorized");
      }
      if (!res.ok || !json?.ok || !json?.reply) throw new Error(json?.message || `Refine failed (${res.status})`);
      const cleaned = sanitizeAiReply(json.reply, subject);
      const withProfile = applyProfilePlaceholders(cleaned);
      setReply(withProfile.trim());
      setReviseNote("");
      setTimeout(()=> replyRef.current?.focus(), 0);
    } catch (e) { setComposeError(e.message || "Failed to refine reply."); }
    finally { setDrafting(false); }
  }

  async function handlePrepare() {
    setTriedSubmit(true); setError(""); setResult(null);
    if (Object.keys(errors).length > 0) return;
    setSubmitting(true);
    try {
      const { res, json } = await postWithFallback("/drafts", {
        to: to.trim(),
        subject: finalSubject.trim(),
        body: finalBody,
        threadId: (threadId||"").trim() || undefined,
      });
      if (res.status === 401) {
        if (json?.error === "NO_SESSION") {
          window.location.href = `${API_BASE}/auth/google?session=${encodeURIComponent(getSessionIdFromUrl())}`; return;
        }
        throw new Error(json?.message || "Unauthorized");
      }
      if (!res.ok || !json?.ok) throw new Error(json?.message || `Draft create failed (${res.status})`);
      setResult(json);
      if (json.gmailUrl) window.open(json.gmailUrl, "_blank", "noopener,noreferrer");
    } catch (e) { setError(e.message || "Failed to create draft."); }
    finally { setSubmitting(false); }
  }

  function handleDiscard() {
    setOriginal("");
    setReply("");
    setResult(null);
    setError("");
    setComposeError("");
  }

  const baseInput = "mt-1 w-full rounded-2xl border px-3 py-2 outline-none focus:ring-2";
  const okRing = "border-gray-200 focus:ring-indigo-500";
  const badRing = "border-red-300 focus:ring-red-500";
  const toInvalid = triedSubmit && !!errors.to;
  const subjectInvalid = triedSubmit && !!errors.subject;
  const replyInvalid = triedSubmit && !!errors.reply;

  const signaturePreview = useMemo(() => {
    const parts = [profile.name, profile.contact].map(s => (s||"").trim()).filter(Boolean);
    return parts.join("\n");
  }, [profile.name, profile.contact]);

  const preview = `Subject: ${finalSubject || "(none)"}\n\n${finalBody || "(reply is empty)"}`;

  return (
    <div id="reply-assistant" ref={containerRef} className="w-full max-w-3xl mx-auto">
      <div className="mb-4">
        <h3 className="text-lg font-semibold tracking-tight">Reply Assistant (CASA-safe)</h3>
        <p className="text-sm text-gray-500">Pick a message above, paste the original, draft with AI, refine, and send to Gmail Drafts.</p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {/* Envelope */}
        <label className="block">
          <span className="text-sm font-medium text-gray-700">To</span>
          <input type="text" placeholder="name@example.com, second@domain.com" value={to} onChange={(e)=>setTo(e.target.value)} className={`${baseInput} ${toInvalid ? badRing : okRing}`} aria-invalid={toInvalid ? "true":"false"} />
          {toInvalid && <p className="mt-1 text-xs text-red-600">{errors.to}</p>}
        </label>

        <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,auto] gap-2 items-end">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Subject</span>
            <input type="text" placeholder="Re: Your question about…" value={subject} onChange={(e)=>setSubject(e.target.value)} className={`${baseInput} ${subjectInvalid ? badRing : okRing}`} aria-invalid={subjectInvalid ? "true":"false"} />
            {subjectInvalid && <p className="mt-1 text-xs text-red-600">{errors.subject}</p>}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4" checked={autoRe} onChange={(e)=>setAutoRe(e.target.checked)} />
            <span className="text-sm text-gray-700 whitespace-nowrap">Auto “Re:”</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-sm text-gray-700">Tone</span>
            <select value={style} onChange={(e)=>setStyle(e.target.value)} className="rounded-xl border border-gray-200 px-2 py-1 text-sm">
              <option value="professional">Professional</option>
              <option value="friendly">Friendly</option>
              <option value="brief">Brief</option>
              <option value="formal">Formal</option>
              <option value="supportive">Supportive</option>
            </select>
          </label>
        </div>

        {/* Profile controls */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={!!profile.useProfile}
              onChange={(e)=>setProfile(p => ({ ...p, useProfile: e.target.checked }))}
            />
            <span className="text-sm text-gray-700">Use my profile to replace placeholders</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={!!profile.appendSignature}
              onChange={(e)=>setProfile(p => ({ ...p, appendSignature: e.target.checked }))}
            />
            <span className="text-sm text-gray-700">Append my signature</span>
          </label>
          <button
            type="button"
            className="ml-auto rounded-2xl border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            onClick={()=>setShowProfileModal(true)}
          >
            Edit Profile…
          </button>
        </div>

        {/* Thread */}
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Thread ID <span className="text-gray-400 font-normal">(optional)</span></span>
          <input type="text" placeholder="Gmail thread ID (keeps your draft in the same conversation)" value={threadId} onChange={(e)=>setThreadId(e.target.value)} className={`${baseInput} ${okRing}`} />
        </label>

        {/* Original */}
        <label className="block">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Original message (paste here)</span>
            <div className="flex items-center gap-2">
              <button ref={pasteOriginalBtnRef} type="button" onClick={()=>pasteInto("original")} disabled={!canUseClipboard || pasting} className="rounded-2xl border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60">{pasting ? "Pasting…" : "Paste"}</button>
            </div>
          </div>
          <textarea ref={originalRef} placeholder="Paste the email you’re replying to." value={original} onChange={(e)=>setOriginal(e.target.value)} rows={8} className={`mt-1 w-full rounded-2xl border px-3 py-3 outline-none focus:ring-2 ${okRing}`} />
        </label>

        {/* Compose + refine */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">Paste the original, then click AI to draft your reply.</div>
            <div className="flex items-center gap-2">
              <button ref={composeBtnRef} type="button" onClick={()=>handleCompose()} disabled={drafting || original.trim().length < 10} className={cx("rounded-2xl px-3 py-1.5 text-sm shadow", (original.trim().length >= 10 && !drafting) ? "bg-white border border-gray-200 hover:bg-gray-50" : "bg-gray-200 text-gray-500 cursor-not-allowed")} title={original.trim().length >= 10 ? "Generate reply" : "Paste the original first"}>
                {drafting ? "Drafting…" : "Write reply with AI"}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={reviseNote}
              onChange={(e)=>setReviseNote(e.target.value)}
              placeholder='Tell AI how to change it (e.g., "shorter", "warmer tone", "add 3 bullets")'
              className="flex-1 rounded-2xl border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={async ()=>{ await handleRefine(); }}
              disabled={drafting || reply.trim().length < 5}
              className={cx("rounded-2xl px-3 py-2 text-sm", (reply.trim().length >= 5 && !drafting) ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-gray-200 text-gray-500 cursor-not-allowed")}
              title="Ask AI to revise the current reply"
            >
              Refine with AI
            </button>
          </div>
        </div>

        {composeError && <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{composeError}</div>}

        {/* Reply */}
        <label className="block">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Your reply</span>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={includeQuote} onChange={(e)=>setIncludeQuote(e.target.checked)} />
              <span className="text-sm text-gray-700">Include quoted original under my reply</span>
            </label>
          </div>
          <textarea
            ref={replyRef}
            placeholder="Type or edit your reply here."
            value={reply}
            onChange={(e)=>setReply(e.target.value)}
            onKeyDown={(e)=>{ if ((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==="enter"){ e.preventDefault(); handlePrepare(); } }}
            rows={10}
            className={`mt-1 w-full rounded-2xl border px-3 py-3 outline-none focus:ring-2 ${replyInvalid ? badRing : okRing}`}
            aria-invalid={replyInvalid ? "true":"false"}
          />
          {replyInvalid && <p className="mt-1 text-xs text-red-600">{errors.reply}</p>}
        </label>

        {/* Preview */}
        <div className="mt-1 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs font-semibold text-gray-600 mb-1">Preview (what will be sent to Drafts)</div>
          <pre className="whitespace-pre-wrap text-sm text-gray-800">{preview}</pre>
        </div>

        {/* Results & errors */}
        {result?.ok && (
          <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center justify-between">
            <span>Draft created in Gmail.</span>
            {result.gmailUrl && (
              <button type="button" onClick={()=>window.open(result.gmailUrl,"_blank","noopener,noreferrer")} className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-sm hover:bg-emerald-50">Open Draft</button>
            )}
          </div>
        )}
        {error && <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

        {/* Actions */}
        <div className="flex items-center justify-between mt-1">
          <div className="text-xs text-gray-500">Tip: <kbd className="px-1.5 py-0.5 rounded border">Ctrl/Cmd + Enter</kbd> creates the draft.</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleDiscard} className="rounded-2xl border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50">Discard reply</button>
            {onCancel && <button type="button" onClick={onCancel} className="rounded-2xl border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50">Cancel</button>}
            <button type="button" onClick={handlePrepare} disabled={submitting} className="rounded-2xl bg-indigo-600 text-white px-4 py-2 text-sm shadow hover:bg-indigo-700 disabled:opacity-60">{submitting ? "Creating…" : "Send to Drafts"}</button>
          </div>
        </div>
      </div>

      {/* Profile modal */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={()=>setShowProfileModal(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-200 p-4">
            <h4 className="text-base font-semibold mb-2">My Profile</h4>
            <div className="grid gap-3">
              <label className="block">
                <span className="text-sm text-gray-700">Name</span>
                <input
                  type="text"
                  value={profile.name || ""}
                  onChange={(e)=>setProfile(p => ({ ...p, name: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Your name"
                />
              </label>
              <label className="block">
                <span className="text-sm text-gray-700">Contact info (signature block)</span>
                <textarea
                  value={profile.contact || ""}
                  onChange={(e)=>setProfile(p => ({ ...p, contact: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  rows={4}
                  placeholder={"Role, Company\nPhone\nWebsite"}
                />
              </label>
              <div className="text-xs text-gray-500">
                Signature preview:
                <pre className="mt-1 whitespace-pre-wrap text-sm text-gray-800 border border-gray-200 rounded-lg p-2 bg-gray-50">{signaturePreview || "(empty)"}</pre>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={()=>setShowProfileModal(false)} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
