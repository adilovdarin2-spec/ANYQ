interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  onEnter: () => void;
  categories: string[];
  activeCategory: string | null;
  onCategoryChange: (category: string | null) => void;
}

export function SearchBar({ query, onQueryChange, onEnter, categories, activeCategory, onCategoryChange }: Props) {
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
      {categories.length > 1 && (
        <div className="category-bar">
          <button
            type="button"
            className={`category-chip${activeCategory === null ? ' on' : ''}`}
            onClick={() => onCategoryChange(null)}
          >
            Все
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`category-chip${activeCategory === c ? ' on' : ''}`}
              onClick={() => onCategoryChange(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
