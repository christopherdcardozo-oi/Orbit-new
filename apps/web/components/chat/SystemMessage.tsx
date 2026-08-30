import React from 'react';

export interface SystemMessageProps {
  message: string;
  type?: 'icebreaker' | 'nudge' | 'info' | 'warning';
}

export const SystemMessage: React.FC<SystemMessageProps> = ({ message, type = 'info' }) => {
  const styles = {
    icebreaker: 'bg-purple-500/10 border-purple-500/20 text-purple-300',
    nudge: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300',
    info: 'bg-gray-800/50 border-gray-700/50 text-gray-400',
    warning: 'bg-red-500/10 border-red-500/20 text-red-300',
  };

  const icons = {
    icebreaker: '✨',
    nudge: '⏰',
    info: 'ℹ️',
    warning: '⚠️',
  };

  return (
    <div className="flex justify-center w-full my-4 animate-in fade-in duration-500">
      <div className={`px-4 py-1.5 rounded-full border text-xs italic flex items-center gap-2 max-w-[85%] text-center ${styles[type]}`}>
        <span>{icons[type]}</span>
        <span>{message}</span>
      </div>
    </div>
  );
};
