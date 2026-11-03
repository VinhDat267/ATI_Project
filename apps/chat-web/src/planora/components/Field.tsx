import { useId, forwardRef, type Ref, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export interface BaseFieldProps {
  label?: string;
  error?: string;
  helper?: string;
  required?: boolean;
  wrapperClassName?: string;
}

export interface InputFieldProps
  extends BaseFieldProps,
    InputHTMLAttributes<HTMLInputElement> {
  multiline?: false;
}

export interface TextareaFieldProps
  extends BaseFieldProps,
    TextareaHTMLAttributes<HTMLTextAreaElement> {
  multiline: true;
}

export type FieldProps = InputFieldProps | TextareaFieldProps;

/**
 * Trường nhập liệu Planora
 * Hỗ trợ cả input một dòng và textarea đa dòng, liên kết nhãn, lỗi và trợ giúp theo chuẩn WCAG.
 */
export const Field = forwardRef<HTMLInputElement | HTMLTextAreaElement, FieldProps>(
  function Field(props, ref) {
    const generatedId = useId();
    const {
      label,
      error,
      helper,
      required,
      id: explicitId,
      multiline = false,
      className = '',
      wrapperClassName = '',
      disabled,
      ...rest
    } = props;

    const id = explicitId || generatedId;
    const errorId = error ? `${id}-error` : undefined;
    const helperId = helper ? `${id}-helper` : undefined;

    const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined;

    const controlClass = [
      multiline ? 'planora-field-textarea' : 'planora-field-input',
      error ? 'planora-field-error-state' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className={`planora-field ${wrapperClassName}`.trim()}>
        {label && (
          <label htmlFor={id} className="planora-field-label">
            {label}
            {required && <span className="planora-field-required" aria-hidden="true">*</span>}
          </label>
        )}

        <div className="planora-field-control-wrapper">
          {multiline ? (
            <textarea
              ref={ref as Ref<HTMLTextAreaElement>}
              id={id}
              className={controlClass}
              disabled={disabled}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              required={required}
              {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
          ) : (
            <input
              ref={ref as Ref<HTMLInputElement>}
              id={id}
              className={controlClass}
              disabled={disabled}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              required={required}
              {...(rest as InputHTMLAttributes<HTMLInputElement>)}
            />
          )}
        </div>

        {error && (
          <div id={errorId} className="planora-field-error" role="alert">
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="7" />
              <line x1="8" y1="5" x2="8" y2="8" />
              <line x1="8" y1="11" x2="8.01" y2="11" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {!error && helper && (
          <div id={helperId} className="planora-field-helper">
            {helper}
          </div>
        )}
      </div>
    );
  }
);
