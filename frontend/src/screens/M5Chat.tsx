import { useEffect, useRef, useState } from "react";
import AppBar, { AiTag } from "../components/AppBar";
import { fileToBase64 } from "../utils/file";

interface ChatTurnResult {
  reply: string;
  turn: number;
  maxTurns: number;
}

interface Props {
  customerName: string;
  isDemo: boolean;
  loading: boolean;
  error: string | null;
  /** demo 모드 전용: 이 케이스의 각본이 상정하는 단일 입력(결과는 어차피 대본대로 고정). */
  hint?: string;
  scriptedChat?: { text: string | null; skip: boolean };
  onDemoSubmit?: (payload: { text: string; attachmentBase64: string | null; skipped: boolean }) => void;
  /** local/remote 모드 전용: 실제 멀티턴 대화. */
  onSendTurn?: (payload: { text: string; attachmentBase64: string | null }) => Promise<ChatTurnResult>;
  /** 대화를 건너뛰거나(0턴) 충분히 나눈 뒤(1턴 이상) 결과 화면으로 넘어간다 — 서버가
   * 세션에 쌓인 대화 유무로 알아서 판단하므로 콜백은 하나면 충분하다. */
  onFinish?: () => void;
}

export default function M5Chat(props: Props) {
  if (props.loading) {
    return (
      <div className="loading-wrap">
        <div className="spinner" />
        <p>AI가 확인 중이에요</p>
      </div>
    );
  }

  return props.isDemo ? <DemoChat {...props} /> : <LiveChat {...props} />;
}

/** demo 모드: 대본대로 고정된 결과가 나오므로, 텍스트 한 번 입력(또는 건너뛰기)만 받는다. */
function DemoChat({ hint, onDemoSubmit, error, scriptedChat }: Props) {
  const [text, setText] = useState("");
  const [attachedName, setAttachedName] = useState<string | null>(null);
  const [attachmentBase64, setAttachmentBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachedName(file.name);
    setAttachmentBase64(await fileToBase64(file));
  }

  const scriptedSkip = scriptedChat?.skip ?? false;
  const scriptedText = scriptedChat?.text ?? null;

  return (
    <>
      <AppBar title="AI 안전확인" />
      <AiTag />
      <div className="chat-bubble">
        현재 송금이 안전한지 AI가 분석해드릴 수도 있어요. {hint || "상황 설명이나 자료 뭐든 올려주시면 확인해드릴게요."}
      </div>

      {scriptedText && (
        <p className="script-hint">
          💡 이 시나리오 입력 예시: "{scriptedText}"{" "}
          <button className="script-hint-fill" onClick={() => setText(scriptedText)}>
            채우기
          </button>
        </p>
      )}
      {scriptedSkip && <p className="script-hint">💡 이 시나리오는 아무것도 입력하지 않고 "건너뛰기"를 눌러주세요</p>}

      <textarea
        placeholder="상황을 설명해주세요 (선택)"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="attach-row">
        <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => fileInputRef.current?.click()}>
          📷 첨부{attachedName ? `: ${attachedName}` : ""}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFile} />
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

      <div className="spacer" />
      <div className="btn-row">
        <button
          className={`btn btn-secondary ${scriptedSkip ? "scripted" : ""}`}
          onClick={() => onDemoSubmit?.({ text: "", attachmentBase64: null, skipped: true })}
        >
          건너뛰기
        </button>
        <button
          className="btn btn-primary"
          disabled={!text && !attachmentBase64}
          onClick={() => onDemoSubmit?.({ text, attachmentBase64, skipped: false })}
        >
          확인 요청
        </button>
      </div>
    </>
  );
}

interface ChatMessage {
  role: "user" | "ai";
  text: string;
}

/** local/remote 모드: 실제 AI 상담원과 2~3턴 정도 주고받는 채팅. 게시판에 글 올리고 결과만
 * 받아보는 방식 대신, 짧게라도 대화를 주고받은 뒤 결론 화면(M6)으로 넘어가게 한다. 대화가
 * 길어지면 안 되므로 턴 수는 백엔드가 하드 캡(MAX_CHAT_TURNS)으로 못박는다. */
function LiveChat({ customerName, onSendTurn, onFinish, error }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "ai", text: `${customerName}님, 편하게 상황을 말씀해주세요. 몇 가지만 확인하고 바로 알려드릴게요.` },
  ]);
  const [input, setInput] = useState("");
  const [attachedName, setAttachedName] = useState<string | null>(null);
  const [attachmentBase64, setAttachmentBase64] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  const [maxTurns, setMaxTurns] = useState(3);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachedName(file.name);
    setAttachmentBase64(await fileToBase64(file));
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && !attachmentBase64) || sending || !onSendTurn) return;

    const attachment = attachmentBase64;
    const attachmentLabel = attachedName;
    setMessages((prev) => [...prev, { role: "user", text: text || `(첨부: ${attachmentLabel})` }]);
    setInput("");
    setAttachedName(null);
    setAttachmentBase64(null);
    setSending(true);
    setSendError(null);

    try {
      const res = await onSendTurn({ text, attachmentBase64: attachment });
      setMessages((prev) => [...prev, { role: "ai", text: res.reply }]);
      setTurn(res.turn);
      setMaxTurns(res.maxTurns);
    } catch {
      // 실패해도 방금 쓴 말이 사라지면 안 되니 입력창에 되돌려 바로 재전송할 수 있게 한다.
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
      setAttachedName(attachmentLabel);
      setAttachmentBase64(attachment);
      setSendError("메시지 전송에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSending(false);
    }
  }

  const reachedCap = turn >= maxTurns;
  const beforeFirstTurn = turn === 0;

  return (
    <>
      <AppBar title="AI 안전확인" />
      <AiTag />

      <div className="chat-thread">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "chat-bubble-user" : "chat-bubble-ai"}>
            {m.text}
          </div>
        ))}
        {sending && (
          <div className="chat-typing">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {turn > 0 && (
        <p className="chat-turn-counter">
          {reachedCap ? "대화를 충분히 확인했어요" : `${turn}/${maxTurns}번 확인했어요`}
        </p>
      )}

      {(sendError || error) && <p style={{ color: "var(--danger)", fontSize: 13 }}>{sendError || error}</p>}

      {!reachedCap && (
        <>
          {attachedName && <div className="chat-attach-chip">📷 {attachedName}</div>}
          <div className="chat-input-row">
            <textarea
              placeholder="상황을 편하게 말씀해주세요"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
            />
            <button className="chat-send-btn" disabled={sending} onClick={() => fileInputRef.current?.click()}>
              📷
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFile} />
            <button
              className="chat-send-btn"
              disabled={sending || (!input.trim() && !attachmentBase64)}
              onClick={handleSend}
            >
              ↑
            </button>
          </div>
        </>
      )}

      <div className="spacer" />

      {beforeFirstTurn && !reachedCap && (
        <button className="chat-skip-link" onClick={onFinish}>
          건너뛰고 바로 결과 볼게요
        </button>
      )}
      {turn > 0 && (
        <button className={`btn ${reachedCap ? "btn-primary" : "btn-outline"}`} onClick={onFinish}>
          결과 확인하기
        </button>
      )}
    </>
  );
}
