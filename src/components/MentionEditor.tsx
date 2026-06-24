import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/src/lib/supabase';
import { Profile } from '@/src/types';

interface MentionEditorProps {
  value: string; // Serialized string format: Hello @[John Doe](mention:uuid)
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  currentUserId: string;
}

export default function MentionEditor({
  value,
  onChange,
  placeholder = 'Write something...',
  className = '',
  currentUserId,
}: MentionEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [triggerRange, setTriggerRange] = useState<Range | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<'above' | 'below'>('above');
  const [dropdownStyles, setDropdownStyles] = useState<React.CSSProperties>({});
  const [isEmpty, setIsEmpty] = useState(true);

  // Connections pagination & search
  const [connections, setConnections] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const checkEmptiness = () => {
    if (editorRef.current) {
      const text = editorRef.current.textContent || '';
      const hasMentions = editorRef.current.querySelector('span[data-id]') !== null;
      setIsEmpty(text.trim() === '' && !hasMentions);
    } else {
      setIsEmpty(true);
    }
  };

  // Sync external value changes
  useEffect(() => {
    if (editorRef.current) {
      const serialized = serializeHtml(editorRef.current);
      if (value !== serialized) {
        editorRef.current.innerHTML = deserializeText(value);
        checkEmptiness();
      }
    }
  }, [value]);

  // Initialize editor content once on mount
  useEffect(() => {
    if (editorRef.current && !editorRef.current.innerHTML) {
      editorRef.current.innerHTML = deserializeText(value);
    }
    checkEmptiness();
  }, []);

  // Listen for outside clicks/taps to close the dropdown
  useEffect(() => {
    const handleOutsideInteraction = (e: MouseEvent | TouchEvent) => {
      if (dropdownVisible && dropdownRef.current && editorRef.current) {
        if (!dropdownRef.current.contains(e.target as Node) && !editorRef.current.contains(e.target as Node)) {
          setDropdownVisible(false);
        }
      }
    };
    document.addEventListener('mousedown', handleOutsideInteraction);
    document.addEventListener('touchstart', handleOutsideInteraction);
    return () => {
      document.removeEventListener('mousedown', handleOutsideInteraction);
      document.removeEventListener('touchstart', handleOutsideInteraction);
    };
  }, [dropdownVisible]);

  // Fetch connections based on searchVal and offset
  const loadConnections = async (search: string, currentOffset: number, isNewSearch = false) => {
    if (!currentUserId) return;
    try {
      setLoading(true);
      const limit = 15;

      let query = supabase
        .from('connections')
        .select('connection_id, profiles!connection_id(id, username, full_name, avatar_url)')
        .eq('user_id', currentUserId);

      if (search.trim()) {
        query = query.or(`username.ilike.%${search}%,full_name.ilike.%${search}%`, { foreignTable: 'profiles' });
      }

      query = query.range(currentOffset, currentOffset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      const profiles = (data?.map((d: any) => d.profiles) || []).filter(Boolean) as Profile[];

      if (isNewSearch) {
        setConnections(profiles);
        setOffset(profiles.length);
      } else {
        setConnections(prev => {
          const combined = [...prev, ...profiles];
          // Deduplicate by ID just in case
          const seen = new Set();
          return combined.filter(p => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
          });
        });
        setOffset(currentOffset + profiles.length);
      }

      setHasMore(profiles.length === limit);
    } catch (err) {
      console.error('Error fetching connections:', err);
    } finally {
      setLoading(false);
    }
  };

  // Sync searchQuery with searchVal and trigger load
  useEffect(() => {
    if (dropdownVisible) {
      setSearchVal(mentionQuery);
      loadConnections(mentionQuery, 0, true);
    }
  }, [dropdownVisible, mentionQuery]);

  // Determine dynamic dropdown placement relative to the @ sign cursor position
  useEffect(() => {
    if (dropdownVisible && triggerRange && editorRef.current) {
      const rect = editorRef.current.getBoundingClientRect();
      
      const rangeRects = triggerRange.getClientRects();
      let rangeRect = rangeRects[0];
      if (!rangeRect) {
        rangeRect = triggerRange.getBoundingClientRect();
      }
      
      if (rangeRect && rangeRect.left !== 0 && rangeRect.top !== 0) {
        const relativeLeft = rangeRect.left - rect.left;
        const relativeTop = rangeRect.top - rect.top;
        const relativeBottom = rangeRect.bottom - rect.top;
        
        const spaceAbove = rangeRect.top;
        const spaceBelow = window.innerHeight - rangeRect.bottom;
        
        if (spaceAbove < 240 && spaceBelow > spaceAbove) {
          setDropdownStyles({
            top: `${relativeBottom + 4}px`,
            left: `${Math.max(0, Math.min(relativeLeft, rect.width - 288))}px`,
            bottom: 'auto',
          });
          setDropdownPosition('below');
        } else {
          setDropdownStyles({
            bottom: `${rect.height - relativeTop + 4}px`,
            left: `${Math.max(0, Math.min(relativeLeft, rect.width - 288))}px`,
            top: 'auto',
          });
          setDropdownPosition('above');
        }
      } else {
        setDropdownStyles({});
      }
    } else {
      setDropdownStyles({});
    }
  }, [dropdownVisible, triggerRange, mentionQuery]);

  // Handle manual search input in the dropdown
  const handleDropdownSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchVal(val);
    setOffset(0);
    setHasMore(true);
    loadConnections(val, 0, true);
  };

  // Infinite Scroll Handler inside dropdown
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (loading || !hasMore) return;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 40) {
      loadConnections(searchVal, offset, false);
    }
  };

  const handleInputOrSelectionChange = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setDropdownVisible(false);
      return;
    }
    const range = selection.getRangeAt(0);
    const container = range.startContainer;

    if (container.nodeType !== Node.TEXT_NODE) {
      setDropdownVisible(false);
      return;
    }

    const text = container.textContent || '';
    const startOffset = range.startOffset;
    const preText = text.substring(0, startOffset);
    const lastAt = preText.lastIndexOf('@');

    if (lastAt !== -1) {
      const afterAt = preText.substring(lastAt + 1);
      // Disappear if the user types a space or non-breakable space after the @ sign
      if (afterAt.includes(' ') || afterAt.includes('\u00A0')) {
        setDropdownVisible(false);
        return;
      }
      setTriggerRange(range.cloneRange());
      setMentionQuery(afterAt);
      setDropdownVisible(true);
      return;
    }
    setDropdownVisible(false);
  };

  const handleContentChange = () => {
    if (editorRef.current) {
      const serialized = serializeHtml(editorRef.current);
      onChange(serialized);
    }
    checkEmptiness();
  };

  // Clear pending deletion highlights on edit/click
  const clearAllHighlights = () => {
    if (editorRef.current) {
      const highlighted = editorRef.current.querySelectorAll('[data-id]');
      highlighted.forEach((el) => {
        el.classList.remove('bg-blue-500/20', 'rounded-sm', 'text-blue-300');
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Backspace') {
      clearAllHighlights();
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    let nodeToDelete: HTMLElement | null = null;

    const startContainer = range.startContainer;
    const startOffset = range.startOffset;

    // Detect if cursor is positioned immediately after a mention node
    if (startContainer.nodeType === Node.TEXT_NODE) {
      if (startOffset === 0) {
        const prevSibling = startContainer.previousSibling;
        if (prevSibling && prevSibling.nodeType === Node.ELEMENT_NODE && (prevSibling as HTMLElement).getAttribute('data-id')) {
          nodeToDelete = prevSibling as HTMLElement;
        }
      } else if (startOffset === 1 && startContainer.textContent?.startsWith('\u00A0')) {
        const prevSibling = startContainer.previousSibling;
        if (prevSibling && prevSibling.nodeType === Node.ELEMENT_NODE && (prevSibling as HTMLElement).getAttribute('data-id')) {
          nodeToDelete = prevSibling as HTMLElement;
        }
      }
    } else if (startContainer.nodeType === Node.ELEMENT_NODE) {
      const childNode = startContainer.childNodes[startOffset - 1];
      if (childNode && childNode.nodeType === Node.ELEMENT_NODE && (childNode as HTMLElement).getAttribute('data-id')) {
        nodeToDelete = childNode as HTMLElement;
      }
    }

    if (nodeToDelete) {
      // Facebook-style delete flow
      if (!nodeToDelete.classList.contains('bg-blue-500/20')) {
        e.preventDefault();
        // Highlight more to indicate impending delete
        nodeToDelete.classList.add('bg-blue-500/20', 'rounded-sm', 'text-blue-300');
      } else {
        e.preventDefault();
        // Delete the trailing space if it exists
        const nextSib = nodeToDelete.nextSibling;
        if (nextSib && nextSib.nodeType === Node.TEXT_NODE && nextSib.textContent?.startsWith('\u00A0')) {
          nextSib.textContent = nextSib.textContent.substring(1);
        }
        nodeToDelete.remove();
        handleContentChange();
      }
    }
  };

  const insertMention = (profile: Profile) => {
    if (!editorRef.current) return;

    const selection = window.getSelection();
    if (!selection || !triggerRange) return;

    const range = triggerRange.cloneRange();
    const textNode = range.startContainer;
    const textVal = textNode.textContent || '';
    const atIdx = textVal.lastIndexOf('@', range.startOffset);

    if (atIdx !== -1) {
      range.setStart(textNode, atIdx);
      // Delete exactly the '@' plus the length of the query
      const endPos = Math.min(textVal.length, atIdx + 1 + mentionQuery.length);
      range.setEnd(textNode, endPos);
      range.deleteContents();

      // Create distinct highlight tag - inline clean blue styling as requested
      const span = document.createElement('span');
      span.className = "text-blue-400 font-semibold cursor-pointer mx-0.5 inline align-baseline hover:underline";
      span.setAttribute('contenteditable', 'false');
      span.setAttribute('data-id', profile.id);
      span.setAttribute('data-name', profile.full_name || profile.username || 'Someone');
      span.textContent = profile.full_name || profile.username || 'Someone';

      range.insertNode(span);

      // Trailing space
      const space = document.createTextNode('\u00A0');
      span.parentNode?.insertBefore(space, span.nextSibling);

      // Move cursor right after the space
      const newRange = document.createRange();
      newRange.setStartAfter(space);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }

    setDropdownVisible(false);
    handleContentChange();
    
    // Refocus editor
    editorRef.current.focus();
  };

  // Helper to serialize HTML back to database formatting
  function serializeHtml(element: HTMLDivElement): string {
    let result = '';
    const childNodes = Array.from(element.childNodes);
    for (const node of childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        result += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === 'SPAN' && el.getAttribute('data-id')) {
          const id = el.getAttribute('data-id');
          const name = el.getAttribute('data-name') || el.textContent;
          result += `@[${name}](mention:${id})`;
        } else if (el.tagName === 'BR') {
          result += '\n';
        } else if (el.tagName === 'DIV' || el.tagName === 'P') {
          const innerText = serializeHtml(el as HTMLDivElement);
          if (innerText) {
            result += '\n' + innerText;
          }
        } else {
          result += el.textContent;
        }
      }
    }
    return result;
  }

  // Helper to deserialize database formatting to contenteditable HTML
  function deserializeText(text: string): string {
    if (!text) return '';
    const regex = /@\[([^\]]+)\]\(mention:([a-f0-9\-]+)\)/g;
    return text.replace(regex, (match, name, id) => {
      return `<span class="text-blue-400 font-semibold cursor-pointer mx-0.5 inline align-baseline hover:underline" contenteditable="false" data-id="${id}" data-name="${name}">${name}</span>&nbsp;`;
    });
  }

  const isDropdownReallyVisible = dropdownVisible && (
    mentionQuery === '' || 
    loading || 
    connections.length > 0
  );

  return (
    <div className="relative w-full">
      <div
        ref={editorRef}
        contentEditable
        onInput={handleContentChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleInputOrSelectionChange}
        onMouseUp={handleInputOrSelectionChange}
        onClick={clearAllHighlights}
        placeholder={placeholder}
        className={`w-full bg-transparent p-2 text-base text-white focus:outline-none ${className.includes('min-h-') ? '' : 'min-h-[80px]'} max-h-[250px] overflow-y-auto resize-none placeholder:text-white/20 select-text ${className}`}
      />
      {isEmpty && (
        <div className={`absolute left-0 top-0 pointer-events-none text-white/20 select-none p-2 ${className.replace('flex-1', '').replace('h-auto', '')}`}>
          {placeholder}
        </div>
      )}

      {/* Connection Mentions Dropdown */}
      {isDropdownReallyVisible && (
        <div
          ref={dropdownRef}
          style={Object.keys(dropdownStyles).length > 0 ? dropdownStyles : {}}
          className={`absolute left-0 w-72 bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl z-[120] flex flex-col overflow-hidden max-h-60 ${
            Object.keys(dropdownStyles).length > 0 ? '' : (dropdownPosition === 'above' ? 'bottom-full mb-2' : 'top-full mt-2')
          }`}
        >
          {/* Connections List */}
          <div
            className="flex-1 overflow-y-auto py-1"
            onScroll={handleScroll}
          >
            {connections.length === 0 ? (
              <div className="px-4 py-3 text-xs text-white/40 text-center">
                {loading ? 'Searching connections...' : 'No connections found'}
              </div>
            ) : (
              connections.map(profile => (
                <button
                  key={profile.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(profile);
                  }}
                  className="w-full px-4 py-2 flex items-center space-x-3 hover:bg-white/5 active:bg-white/10 transition-colors text-left"
                >
                  <div className="w-6 h-6 rounded-full overflow-hidden bg-white/10 border border-white/10 shrink-0">
                    {profile.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-white/50">
                        {profile.username?.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 truncate">
                    <p className="text-xs font-semibold text-white/95 truncate">
                      {profile.full_name || profile.username}
                    </p>
                  </div>
                </button>
              ))
            )}

            {loading && connections.length > 0 && (
              <div className="flex justify-center py-2 shrink-0">
                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
