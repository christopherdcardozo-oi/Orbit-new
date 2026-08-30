'use client'

import React, { forwardRef } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, ...props }, ref) => {
    return (
      <div className="flex flex-col w-full">
        {label && (
          <label className="mb-1 text-sm font-medium text-gray-300">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`bg-gray-800/50 border ${error ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500' : 'border-gray-700 focus:ring-purple-500/50 focus:border-purple-500'} text-white placeholder-gray-500 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 transition-all ${className}`}
          {...props}
        />
        {error && (
          <span className="mt-1 text-sm text-red-500">
            {error}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
