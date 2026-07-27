interface Props {
  title: string;
  message: string;
}

export function StateScreen({ title, message }: Props) {
  return (
    <div className="state-screen">
      <div className="state-card">
        <div className="mark">A</div>
        <h1>{title}</h1>
        <p>{message}</p>
      </div>
    </div>
  );
}
