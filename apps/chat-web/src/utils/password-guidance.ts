interface PasswordGuidance {
  filledBars: number;
  barTone: 'empty' | 'danger' | 'warning' | 'filled';
  label: string;
  tone: 'muted' | 'danger';
}

export function evaluatePasswordGuidance(password: string, blurred: boolean): PasswordGuidance {
  if (!password) {
    return {
      filledBars: 0,
      barTone: 'empty',
      label: 'Tối thiểu 12 ký tự, nên kết hợp chữ hoa, chữ thường, số và ký tự đặc biệt.',
      tone: 'muted',
    };
  }

  if (password.length < 12) {
    if (!blurred) {
      return {
        filledBars: 1,
        barTone: 'warning',
        label: `Còn thiếu ${12 - password.length} ký tự nữa (${password.length}/12 ký tự tối thiểu)`,
        tone: 'muted',
      };
    }
    return {
      filledBars: 1,
      barTone: 'danger',
      label: `Mật khẩu cần ít nhất 12 ký tự (hiện có ${password.length}/12)`,
      tone: 'danger',
    };
  }

  let filledBars = 1;
  if (/\p{Lu}/u.test(password) && /\p{Ll}/u.test(password)) filledBars++;
  if (/\p{Nd}/u.test(password)) filledBars++;
  if (/[\p{P}\p{S}]/u.test(password)) filledBars++;
  return {
    filledBars,
    barTone: 'filled',
    label: `Đạt ${filledBars}/4 gợi ý về ký tự. Ưu tiên mật khẩu dài, riêng cho Planora.`,
    tone: 'muted',
  };
}
