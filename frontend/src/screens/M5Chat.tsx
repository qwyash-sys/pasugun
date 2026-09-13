import { useRef, useState } from "react";
import AppBar, { AiTag } from "../components/AppBar";
import { fileToBase64 } from "../utils/file";

interface Props {
  hint: string;
  onSubmit: (payload: { text: string; attachmentBase64: string | null; skipped: boolean }) => void;
  loading: boolean;
  error: string | null;
}

export default function M5Chat({ hint, onSubmit, loading, error }: Props) {
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

  if (loading) {
    return (
      <div className="loading-wrap">
        <div className="spinner" />
        <p>AI가 확인 중이에요</p>
      </div>
    );
  }

  return (
    <>
      <AppBar title="AI 안전확인" />
      <AiTag />
      <div className="chat-bubble">
        현재 송금이 안전한지 AI가 분석해드릴 수도 있어요. {hint || "상황 설명이나 자료 뭐든 올려주시면 확인해드릴게요."}
      </div>

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
          className="btn btn-secondary"
          onClick={() => onSubmit({ text: "", attachmentBase64: null, skipped: true })}
        >
          건너뛰기
        </button>
        <button
          className="btn btn-primary"
          disabled={!text && !attachmentBase64}
          onClick={() => onSubmit({ text, attachmentBase64, skipped: false })}
        >
          확인 요청
        </button>
      </div>
    </>
  );
}
