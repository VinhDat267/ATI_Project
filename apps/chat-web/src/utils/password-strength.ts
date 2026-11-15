export interface PasswordStrengthResult {
  filledBars: 0 | 1 | 2 | 3 | 4;
  barTone: 'empty' | 'danger' | 'warning' | 'success';
  label: string;
  tone: 'muted' | 'warning' | 'danger' | 'success';
}

/** Evaluates password readiness for the signup strength meter with deferred error state. */
export function evaluatePasswordStrength(password: string, blurred = false): PasswordStrengthResult {
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

  let score = 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) {
    return {
      filledBars: 1,
      barTone: 'warning',
      label: 'Độ mạnh: Đạt mức tối thiểu (12+ ký tự)',
      tone: 'warning',
    };
  }
  if (score === 2) {
    return {
      filledBars: 2,
      barTone: 'warning',
      label: 'Độ mạnh: Tốt',
      tone: 'warning',
    };
  }
  if (score === 3) {
    return {
      filledBars: 3,
      barTone: 'success',
      label: 'Độ mạnh: Rất an toàn',
      tone: 'success',
    };
  }
  return {
    filledBars: 4,
    barTone: 'success',
    label: 'Độ mạnh: Tuyệt vời',
    tone: 'success',
  };
}
