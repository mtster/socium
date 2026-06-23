import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import React from 'react';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(date));
}

export function renderClickableAndMentionText(
  text: string,
  onUserClick?: (userId: string) => void
): React.ReactNode {
  if (!text) return '';

  // Match URL or Match Mentions: @[Name](mention:UUID)
  const regex = /(https?:\/\/[^\s]+)|@\[([^\]]+)\]\(mention:([a-f0-9\-]+)\)/g;

  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const index = match.index;

    // Add preceding plain text
    if (index > lastIndex) {
      parts.push(text.substring(lastIndex, index));
    }

    const [fullMatch, urlGroup, mentionNameGroup, mentionIdGroup] = match;

    if (urlGroup) {
      // It's a URL
      parts.push(
        React.createElement(
          'a',
          {
            key: index,
            href: urlGroup,
            target: "_blank",
            rel: "noopener noreferrer",
            className: "text-blue-400 hover:underline break-all select-text cursor-pointer",
            onClick: (e: any) => e.stopPropagation()
          },
          urlGroup
        )
      );
    } else if (mentionNameGroup && mentionIdGroup) {
      // It's a Mention
      parts.push(
        React.createElement(
          'span',
          {
            key: index,
            onClick: (e: any) => {
              e.stopPropagation();
              if (onUserClick) onUserClick(mentionIdGroup);
            },
            className: "bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded-md font-semibold cursor-pointer transition-colors select-none inline-block align-baseline mx-0.5"
          },
          mentionNameGroup
        )
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export function extractMentionedUserIds(text: string): string[] {
  if (!text) return [];
  const regex = /@\[[^\]]+\]\(mention:([a-f0-9\-]+)\)/g;
  const ids: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) ids.push(match[1]);
  }
  return Array.from(new Set(ids));
}
