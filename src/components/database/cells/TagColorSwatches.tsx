import { TAG_HUES, tagSwatchColor } from './tagColor';

interface Props {
  current: number | undefined;
  onPick: (hueIndex: number | null) => void;
}

/// Inline 12-swatch palette for picking a tag color. Plus a "reset" dot that
/// clears any explicit override and falls back to the auto-hashed color.
export function TagColorSwatches({ current, onPick }: Props) {
  return (
    <div className="db-tag-swatches" onMouseDown={(e) => e.stopPropagation()}>
      {TAG_HUES.map((_h, idx) => (
        <button
          key={idx}
          type="button"
          className={`db-tag-swatch ${current === idx ? 'is-active' : ''}`}
          style={{ background: tagSwatchColor(idx) }}
          title={`Color ${idx + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            onPick(idx);
          }}
        />
      ))}
      <button
        type="button"
        className={`db-tag-swatch db-tag-swatch-reset ${current === undefined ? 'is-active' : ''}`}
        title="Auto color"
        onClick={(e) => {
          e.stopPropagation();
          onPick(null);
        }}
      >
        ×
      </button>
    </div>
  );
}
