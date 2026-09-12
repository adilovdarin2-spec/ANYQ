import type { Ref } from 'react';
import { useTranslation } from '../i18n/useLanguage';

interface Props {
  /**
   * Поле поиска само по себе, чтобы касса могла вернуть в него курсор.
   *
   * Нужно только терминалу: там курсор уезжает от каждого нажатия, а сканер
   * печатает туда, где курсор. На телефоне остаётся пустым — фокусировать поле
   * там значит открывать экранную клавиатуру поверх товаров.
   */
  inputRef?: Ref<HTMLInputElement>;
  query: string;
  onQueryChange: (value: string) => void;
  onEnter: () => void;
  /**
   * Штрихкод, который просканировали и не нашли.
   *
   * Стоит на месте подсказки про сканер, а не отдельной строкой: подсказка
   * нужна, пока ничего не происходит, а когда скан не нашёлся — нужна не она.
   */
  scanMiss?: string | null;
  categories: string[];
  activeCategory: string | null;
  onCategoryChange: (category: string | null) => void;
}

export function SearchBar({ inputRef, query, onQueryChange, onEnter, scanMiss, categories, activeCategory, onCategoryChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        type="text"
        inputMode="search"
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter();
        }}
      />
      <div className={scanMiss ? 'search-hint miss' : 'search-hint'}>
        {scanMiss ? t('search.scanMiss', { code: scanMiss }) : t('search.scannerHint')}
      </div>
      {categories.length > 1 && (
        <div className="category-bar">
          <button
            type="button"
            className={`category-chip${activeCategory === null ? ' on' : ''}`}
            onClick={() => onCategoryChange(null)}
          >
            {t('search.all')}
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
