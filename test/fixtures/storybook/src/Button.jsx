/** Primary UI component for user interaction */
export const Button = ({ primary = false, size = 'medium', label = 'Button', ...props }) => (
  <button type="button" style={{ background: primary ? '#1ea7fd' : '#eee', color: primary ? '#fff' : '#333', border: 0, borderRadius: 24, padding: size === 'large' ? '12px 24px' : '8px 16px', fontWeight: 700 }} {...props}>{label}</button>
);
