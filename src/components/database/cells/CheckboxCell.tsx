interface Props {
  value: boolean;
  onChange: (next: boolean) => void;
}

export function CheckboxCell({ value, onChange }: Props) {
  return (
    <input
      type="checkbox"
      className="db-cell-checkbox"
      checked={!!value}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
