'use client'

import React from 'react';

export interface MessageBubbleProps {
  content: string;
  isOwn: boolean;
  timestamp: string;
  alias?: string;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ content, isOwn, timestamp, alias }) => {
  return (
    <div className={`flex flex-col w-full animate-in slide-in-from-bottom-2 fade-in duration-300 ${isOwn ? 'items-end' : 'items-start'} mb-4`}>
      {!isOwn && alias && (
        <span className="text-xs text-gray-400 mb-1 ml-1">{alias}</span>
      )}
      <div
        className={`px-4 py-2 max-w-[80%] break-words ${
          isOwn
            ? 'bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl rounded-br-md text-white'
            : 'bg-gray-800 rounded-2xl rounded-bl-md text-white border border-gray-700/50'
        }`}
      >
        {content}
      </div>
      <span className={`text-[10px] text-gray-500 mt-1 ${isOwn ? 'mr-1' : 'ml-1'}`}>
        {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
};
