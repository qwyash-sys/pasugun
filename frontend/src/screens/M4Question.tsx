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
}

export default function M4Question({ payeeBank, payeeName, amount, questions, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerSubmission[]>([]);

  const question = questions[index];
  const isBinary = question.choices.length === 2;

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

        {isBinary ? (
          <div className="yesno-row">
            {question.choices.map((choice) => (
              <button key={choice.choice_id} onClick={() => choose(choice.choice_id)}>
                {choice.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="choice-list">
            {question.choices.map((choice) => (
              <button key={choice.choice_id} className="choice-btn" onClick={() => choose(choice.choice_id)}>
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
