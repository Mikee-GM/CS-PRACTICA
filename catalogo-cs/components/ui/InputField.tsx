"use client";

import React, { useId } from "react";

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export default function InputField({ label, id, ...props }: InputFieldProps) {
  // Sin esta asociacion el rotulo no nombra al campo: un lector de pantalla
  // anunciaba "campo de edicion" a secas y tocar el rotulo no daba foco.
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
      <input
        id={idCampo}
        className="w-full bg-black border border-zinc-800 text-white text-base font-medium px-4 py-3.5 transition-all duration-200 focus:border-[#C5A55A] placeholder:text-zinc-600 focus:outline-none"
        {...props}
      />
    </div>
  );
}
