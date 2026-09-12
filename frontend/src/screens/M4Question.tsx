import { useState } from "react";
import TopBar from "../components/TopBar";
import type { AnswerSubmission, Question } from "../types";

interface Props {
  questions: Question[];
  onDone: (answers: AnswerSubmission[]) => void;
}

export default function M4Question({ questions, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerSubmission[]>([]);

  const question = questions[index];

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
      <TopBar />
      <p className="subtitle">
        {index + 1} / {questions.length}
      </p>
      <div className="card">
        <p style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>{question.prompt}</p>
      </div>
      <div className="choice-list">
        {question.choices.map((choice) => (
          <button key={choice.choice_id} className="choice-btn" onClick={() => choose(choice.choice_id)}>
            {choice.label}
          </button>
        ))}
      </div>
    </>
  );
}
