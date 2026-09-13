import { useState } from "react";
import AppBar from "../components/AppBar";
import BankBadge from "../components/BankBadge";
import BottomSheet from "../components/BottomSheet";
import type { AnswerSubmission, Question } from "../types";

interface Props {
  payeeBank: string;
  payeeName: string;
  amount: number;
  questions: Question[];
  onDone: (answers: AnswerSubmission[]) => void;
  /** demo 모드에서만: 이 케이스의 각본이 실제로 상정하는 question_id -> choice_id.
   * local/remote 모드에서는 undefined — 실제 선택이 실제로 점수에 반영되므로 힌트가 없다. */
  scriptedAnswers?: Record<string, string>;
}

export default function M4Question({ payeeBank, payeeName, amount, questions, onDone, scriptedAnswers }: Props) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerSubmission[]>([]);

  const question = questions[index];
  const isBinary = question.choices.length === 2;
  const recommendedChoiceId = scriptedAnswers?.[question.question_id];

  function choose(choiceId: string) {
    const next = [...answers, { question_id: question.question_id, choice_id: choiceId }];
    if (index + 1 < questions.length) {
      setAnswers(next);
      setIndex(index + 1);
    } else {
      onDone(next);
    }
  }

  return (
    <>
      <div className="sheet-behind">
        <AppBar title="이체확인" />
        <div className="card">
          <div className="recipient-row">
            <BankBadge bank={payeeBank} />
            <div>
              <div className="name">{payeeName}</div>
              <div className="sub">
                {payeeBank} · {amount.toLocaleString()}원
              </div>
            </div>
          </div>
        </div>
      </div>

      <BottomSheet>
        <p className="subtitle" style={{ marginBottom: 4 }}>
          보이스피싱, 한 번 더 확인해 주세요 · {index + 1}/{questions.length}
        </p>
        <h1 className="title" style={{ lineHeight: 1.4 }}>
          {question.prompt}
        </h1>

        {recommendedChoiceId && (
          <p className="script-hint">💡 이 시나리오는 아래 강조된 선택지를 눌러주세요</p>
        )}

        {isBinary ? (
          <div className="yesno-row">
            {question.choices.map((choice) => (
              <button
                key={choice.choice_id}
                className={choice.choice_id === recommendedChoiceId ? "scripted" : ""}
                onClick={() => choose(choice.choice_id)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="choice-list">
            {question.choices.map((choice) => (
              <button
                key={choice.choice_id}
                className={`choice-btn ${choice.choice_id === recommendedChoiceId ? "scripted" : ""}`}
                onClick={() => choose(choice.choice_id)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
