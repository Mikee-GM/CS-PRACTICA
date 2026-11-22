"use client";

import React, { useId } from "react";

interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: { value: string; label: string }[];
}

export default function SelectField({ label, options, id, ...props }: SelectFieldProps) {
  // Ver InputField: el rotulo tiene que estar asociado al control para nombrarlo.
  const idGenerado = useId();
  const idCampo = id ?? idGenerado;

  return (
    <div>
      <label
        htmlFor={idCampo}
        className="block text-xs font-bold tracking-widest text-[#C5A55A] uppercase mb-2"
      >
        {label}
      </label>
      <select
        id={idCampo}
        className="w-full bg-black border border-zinc-800 text-white text-base font-medium px-4 py-3.5 transition-all duration-200 focus:border-[#C5A55A] placeholder:text-zinc-600 focus:outline-none"
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
