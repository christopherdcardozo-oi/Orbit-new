'use client'

import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageBubble } from './MessageBubble';
import { SystemMessage } from './SystemMessage';
import { ChatInput } from './ChatInput';
import { Message } from '@/types/database';

export interface ChatWindowProps {
  matchId: string;
  currentUserId: string;
  partnerAlias: string;
  icebreaker?: string;
  initialMessages: Message[];
  expiresAt: string;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  matchId,
  currentUserId,
  partnerAlias,
  icebreaker,
  initialMessages,
  expiresAt
}) => {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [nudge, setNudge] = useState<string | null>(null);
  const supabase = createClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, nudge]);

  useEffect(() => {
    const channel = supabase.channel(`match-${matchId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `match_id=eq.${matchId}`
      }, (payload) => {
        if (payload.new.sender_id !== currentUserId) {
          setMessages(prev => [...prev, payload.new as Message]);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, currentUserId, supabase]);

  useEffect(() => {
    const checkTime = () => {
      const now = new Date().getTime();
      const expirationTime = new Date(expiresAt).getTime();
      const timeRemaining = expirationTime - now;

      // 12 hours = 43200000 ms, 1 hour = 3600000 ms
      if (timeRemaining > 0) {
        if (timeRemaining <= 3600000 && timeRemaining > 3540000) {
           setNudge("🌙 One hour left! If you'd like to stay in touch, now's the time.");
        } else if (timeRemaining <= 43200000 && timeRemaining > 43140000) {
           setNudge("⏰ Halfway through! Your connection resets at midnight.");
        }
      }
    };
    
    checkTime();
    const interval = setInterval(checkTime, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleSendMessage = async (content: string) => {
    const tempId = crypto.randomUUID();
    const newMessage: Message = {
      id: tempId,
      match_id: matchId,
      sender_id: currentUserId,
      content,
      created_at: new Date().toISOString(),
    };

    // Optimistic update
    setMessages(prev => [...prev, newMessage]);

    const { error } = await supabase
      .from('messages')
      .insert({
        match_id: matchId,
        sender_id: currentUserId,
        content,
      });

    if (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic update
      setMessages(prev => prev.filter(m => m.id !== tempId));
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50 backdrop-blur-md">
        <h2 className="text-lg font-semibold text-white">{partnerAlias}</h2>
        <div className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
          Closes {new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
        {icebreaker && (
          <SystemMessage message={icebreaker} type="icebreaker" />
        )}
        
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            content={msg.content}
            isOwn={msg.sender_id === currentUserId}
            timestamp={msg.created_at ?? new Date().toISOString()}
            alias={msg.sender_id !== currentUserId ? partnerAlias : undefined}
          />
        ))}

        {nudge && (
          <SystemMessage message={nudge} type="nudge" />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-gray-800 bg-gray-900/30">
        <ChatInput onSend={handleSendMessage} />
      </div>
    </div>
  );
};
