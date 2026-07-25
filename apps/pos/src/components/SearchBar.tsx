interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  onEnter: () => void;
}

export function SearchBar({ query, onQueryChange, onEnter }: Props) {
  return (
    <div className="search-bar">
      <input
        type="text"
        inputMode="search"
        placeholder="Название или штрихкод"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter();
        }}
      />
      <div className="search-hint">Штрихкод-сканер работает как клавиатура — просто наведите и нажмите</div>
    </div>
  );
}
