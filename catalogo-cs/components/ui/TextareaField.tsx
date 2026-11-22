"use client";

import React, { useCallback, useEffect, useId, useRef } from "react";

interface TextareaFieldProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  autoResize?: boolean;
}

export default function TextareaField({
  label,
  autoResize = true,
  className,
  value,
  onChange,
  rows = 4,
  id,
  ...props
}: TextareaFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Ver InputField: el rotulo tiene que estar asociado al control para nombrarlo.
  const idGenerado = useId();
  const idCampo = id ?? idGenerado;

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea && autoResize) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.max(textarea.scrollHeight, 80)}px`;
    }
  }, [autoResize]);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e);
    if (autoResize) {
      adjustHeight();
    }
  };

  return (
    <div>
      <label
        htmlFor={idCampo}
        className="block text-xs font-bold tracking-widest text-[#C5A55A] uppercase mb-2"
      >
        {label}
      </label>
      <textarea
        id={idCampo}
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={handleChange}
        className={`w-full bg-black border border-zinc-800 text-white text-base font-medium px-4 py-3.5 transition-colors duration-200 focus:border-[#C5A55A] placeholder:text-zinc-600 focus:outline-none resize-none ${autoResize ? "overflow-hidden" : ""} ${className || ""}`}
        {...props}
      />
    </div>
  );
}
