import { useState, type JSX } from 'react';

type Props = {
  id: string;
  label: string;
  value: string;
  autoComplete: 'new-password' | 'current-password';
  onChange: (value: string) => void;
};

/**
 * A password input with a Show toggle, for the forms where the password is new
 * and a typo would lock the person out. The toggle sits outside the label, so
 * the field is found by its label alone.
 */
export function PasswordField({ id, label, value, autoComplete, onChange }: Props): JSX.Element {
  const [shown, setShown] = useState(false);

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__with-action">
        <input
          id={id}
          className="field__input"
          type={shown ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <button
          className="button button--small"
          type="button"
          onClick={() => {
            setShown((current) => !current);
          }}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}
