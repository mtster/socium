import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MapPin, Phone, Video } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { parseLocation, openInNativeMaps } from "./locationUtils";
import { AudioPlayer } from "./AudioPlayer";
import { Linkify } from "./Linkify";
import { supabase } from "@/src/lib/supabase";

function formatMessageDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  
  const now = new Date();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;
  
  const isSameYear = date.getFullYear() === now.getFullYear();
  const isSameDay = date.getDate() === now.getDate() &&
                    date.getMonth() === now.getMonth() &&
                    isSameYear;
                    
  if (isSameDay) return timeStr;
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[date.getMonth()];
  const day = date.getDate();
  
  if (isSameYear) {
    return `${monthName} ${day} at ${timeStr}`;
  } else {
    return `${date.getFullYear()}, ${monthName} ${day} at ${timeStr}`;
  }
}

export const MessageBubble = React.memo(
  ({
    msg,
    isMine,
    nextMsg,
    prevMsg,
    activeChat,
    setViewingImage,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onCloseChat,
    contextMenuId,
    currentUserId,
    onOpenProfile,
    showDate,
    onToggleDate,
  }: any) => {
    let senderProfile = null;
    if (!isMine && activeChat.isGroup && activeChat.participants) {
      senderProfile = activeChat.participants.find(
        (p: any) => p.id === msg.sender_id,
      );
    } else if (!isMine && !activeChat.isGroup) {
      senderProfile = activeChat; // In 1v1, activeChat is basically the profile (or we use activeChat.profile)
      if (activeChat.profile) senderProfile = activeChat.profile;
    }

    if (msg.media_type === "system") {
      let text = msg.content;
      let actorName = "Someone";

      if (msg.metadata) {
        const m =
          typeof msg.metadata === "string"
            ? JSON.parse(msg.metadata)
            : msg.metadata;
        const actorId = m.actorId;
        const isActorMe = actorId === currentUserId;

        let actorProfile = null;
        if (!isActorMe && activeChat.participants) {
          actorProfile = activeChat.participants.find(
            (p: any) => p.id === actorId,
          );
        }
        actorName = isActorMe
          ? "You"
          : actorProfile?.full_name?.split(" ")[0] ||
            actorProfile?.username ||
            "Someone";

        switch (m.type) {
          case "USER_ADDED":
            text = `added ${m.addedNames} to the group`;
            break;
          case "USER_REMOVED":
            text = `removed ${m.removedName}`;
            break;
          case "ADMIN_ASSIGNED":
            text = `made ${m.newAdminName} the group admin`;
            break;
          case "GROUP_NAME_CHANGED":
            text = `changed group name to "${m.newName}"`;
            break;
          case "EDIT_PERMISSION_CHANGED":
            text = m.newValue
              ? "allowed everyone to edit group settings"
              : "restricted editing to admins";
            break;
          case "AVATAR_CHANGED":
            text = `changed the group picture`;
            break;
          case "AVATAR_REMOVED":
            text = `removed the group picture`;
            break;
          case "USER_LEFT":
            text = `left the group`;
            break;
          default:
            break;
        }
      } else {
        actorName = isMine
          ? "You"
          : senderProfile?.full_name?.split(" ")[0] ||
            senderProfile?.username ||
            "Someone";
      }

      return (
        <div className="flex w-full justify-center my-2 select-none">
          <span className="text-[11px] border border-current text-white/50 px-4 py-1.5 rounded-full text-center tracking-[0.02em] max-w-[85%] leading-snug font-light">
            <span className="font-medium text-white/80">{actorName}</span>{" "}
            {text}
          </span>
        </div>
      );
    }

    const [sharedPost, setSharedPost] = useState<any>(null);
    const [loadingPost, setLoadingPost] = useState(false);

    useEffect(() => {
      if (msg.media_type === "shared_post" && msg.metadata) {
        const meta =
          typeof msg.metadata === "string"
            ? JSON.parse(msg.metadata)
            : msg.metadata;
        const postId = meta?.shared_post_id;
        if (postId) {
          setLoadingPost(true);
          supabase
            .from("posts")
            .select("*, profiles(*)")
            .eq("id", postId)
            .maybeSingle()
            .then(({ data }) => {
              if (data) {
                setSharedPost(data);
              }
              setLoadingPost(false);
            });
        }
      }
    }, [msg.media_type, msg.metadata]);

    const isConsecutive =
      nextMsg?.sender_id === msg.sender_id && nextMsg?.media_type !== "system";
    const isPrevConsecutive =
      prevMsg?.sender_id === msg.sender_id && prevMsg?.media_type !== "system";
    const showAvatar = !isMine && !isConsecutive;

    let rounded = "rounded-[20px]";
    if (isMine) {
      rounded = isConsecutive
        ? isPrevConsecutive
          ? "rounded-[20px] rounded-tr-[4px] rounded-br-[4px]"
          : "rounded-[20px] rounded-br-[4px]"
        : isPrevConsecutive
          ? "rounded-[20px] rounded-tr-[4px]"
          : "rounded-[20px]";
    } else {
      rounded = isConsecutive
        ? isPrevConsecutive
          ? "rounded-[20px] rounded-tl-[4px] rounded-bl-[4px]"
          : "rounded-[20px] rounded-bl-[4px]"
        : isPrevConsecutive
          ? "rounded-[20px] rounded-tl-[4px]"
          : "rounded-[20px]";
    }
    const locMatch = msg.content?.match(
      /(https?:\/\/(www\.)?(google\.com\/maps|maps\.apple\.com)[^\s]*)/,
    );
    const isLoc = msg.media_type === "location" || !!locMatch;
    const isSharedPost = msg.media_type === "shared_post";
    const isCall = msg.media_type === "call_audio" || msg.media_type === "call_video";
    const isMediaOnly =
      isSharedPost ||
      isCall ||
      ((msg.media_type === "image" || isLoc || msg.media_type === "audio") &&
        (!msg.content || (locMatch && msg.content === locMatch[0])));

    return (
      <div className="flex flex-col w-full">
        <AnimatePresence>
          {showDate && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={
                contextMenuId === msg.id 
                  ? { opacity: 1, height: "auto", scale: 1.05, y: -8, zIndex: 110 } 
                  : { opacity: 1, height: "auto", scale: 1, y: 0, zIndex: 10 }
              }
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="flex justify-center w-full overflow-hidden select-none pointer-events-none relative"
              style={{ originY: 1, willChange: "height, opacity" }}
            >
              <div className="pt-2 pb-1 block">
                <span className="text-[11px] font-sans font-medium text-white/40 tracking-wide text-center">
                  {formatMessageDate(msg.created_at)}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div
          className={cn(
            "flex w-full gap-2 relative",
            isMine ? "justify-end" : "justify-start",
            isConsecutive
              ? "mb-[2px]"
              : !isMine && !isPrevConsecutive && activeChat.isGroup
                ? "mb-4"
                : "mb-3",
          )}
        >
        {!isMine && (
          <div className="w-8 shrink-0 flex items-end mb-0.5">
            {showAvatar ? (
              <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 border border-white/10">
                {senderProfile?.avatar_url ? (
                  <img
                    src={senderProfile.avatar_url}
                    className="w-full h-full object-cover"
                    alt=""
                  />
                ) : (
                  <div className="w-full h-full items-center justify-center flex text-[10px] text-white/50">
                    {(
                      senderProfile?.username?.charAt(0) ||
                      senderProfile?.full_name?.charAt(0) ||
                      "?"
                    ).toUpperCase()}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-8" />
            )}
          </div>
        )}
        <div
          className={cn(
            "flex flex-col max-w-[75%]",
            isMine ? "items-end" : "items-start",
          )}
        >
          {!isMine &&
            activeChat.isGroup &&
            !isPrevConsecutive &&
            senderProfile && (
              <span className="text-[11px] text-white/50 ml-1 mb-1">
                {senderProfile.full_name?.split(" ")[0] ||
                  senderProfile.username}
              </span>
            )}
          <motion.div
            id={`msg-inner-${msg.id}`}
            onContextMenu={(e) => e.preventDefault()}
            onTouchStart={(e: any) => onTouchStart(e, msg)}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onClick={(e) => {
              if (!isMediaOnly || isCall) {
                e.stopPropagation();
                onToggleDate?.();
              }
            }}
            animate={
              contextMenuId === msg.id
                ? { scale: 1.05, zIndex: 100 }
                : { scale: 1, zIndex: 1 }
            }
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            style={{ willChange: "transform", transform: "translateZ(0)", backfaceVisibility: "hidden" }}
            className={cn(
              "min-w-[2rem] text-[15px] whitespace-pre-wrap break-words transition-colors duration-300 relative select-none [user-select:none] [-webkit-user-select:none]",
              rounded,
              !isMediaOnly &&
                (isMine
                  ? "bg-white text-black shadow-sm"
                  : "bg-[#262626] text-white shadow-sm"),
              !msg.media_type && !isLoc && "px-3.5 py-2",
              (msg.media_type === "image" || isLoc || msg.media_type === "shared_post") &&
                "p-0 rounded-[22px] overflow-hidden bg-transparent border-0 shadow-none",
            )}
          >
            {msg.media_type === "shared_post" && (
              <motion.div 
                layout 
                transition={{ type: "spring", stiffness: 220, damping: 26 }} 
                className="overflow-hidden rounded-[20px]"
              >
                {loadingPost ? (
                  <motion.div 
                    key="shared-loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-56 h-64 p-4 bg-zinc-950/40 border border-white/10 rounded-[20px] flex flex-col gap-3 min-w-[224px] select-none"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-white/10 animate-pulse" />
                      <div className="h-3 w-20 bg-white/10 rounded animate-pulse" />
                    </div>
                    <div className="flex-1 bg-white/5 rounded-xl animate-pulse flex items-center justify-center">
                      <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    </div>
                  </motion.div>
                ) : !sharedPost ? (
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl text-xs text-white/30 select-none">
                    Post unavailable or deleted
                  </div>
                ) : (
                  <motion.div 
                    key="shared-loaded"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    onClick={() => {
                      sessionStorage.setItem("scroll_to_post_id", sharedPost.id);
                      if (sharedPost.user_id === currentUserId) {
                        onCloseChat?.();
                        window.dispatchEvent(new CustomEvent('openOwnProfileAndScroll', { detail: { postId: sharedPost.id } }));
                      } else {
                        window.dispatchEvent(new CustomEvent('openProfile', { detail: { userId: sharedPost.user_id, forcePopup: true } }));
                      }
                    }}
                    className="w-56 cursor-pointer overflow-hidden rounded-[20px] bg-black border border-white/10 active:scale-98 transition-all duration-200"
                  >
                    {/* Post Author info */}
                    <div className="flex items-center gap-2 p-2.5">
                      <div className="w-6 h-6 rounded-full overflow-hidden bg-white/5 shrink-0 border border-white/10">
                        {sharedPost.profiles?.avatar_url ? (
                          <img src={sharedPost.profiles.avatar_url} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[8px] text-white/40 font-bold">
                            {(sharedPost.profiles?.username?.[0] || "?").toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11px] font-bold text-white tracking-tight block truncate">
                          {sharedPost.profiles?.full_name || sharedPost.profiles?.username}
                        </span>
                      </div>
                    </div>

                    {/* Post Images if any */}
                    {sharedPost.image_url && (
                      <div className="w-full aspect-square relative bg-white/5 overflow-hidden">
                        <img 
                          src={sharedPost.image_url.split(",")[0]} 
                          className="w-full h-full object-cover" 
                          alt="" 
                        />
                      </div>
                    )}

                    {/* Caption */}
                    {sharedPost.caption && (
                      <div className="p-3 border-t border-white/[0.04]">
                        <p className="text-[11px] text-white/70 line-clamp-2 leading-relaxed whitespace-pre-wrap font-sans">
                          {sharedPost.caption}
                        </p>
                      </div>
                    )}
                  </motion.div>
                )}
              </motion.div>
            )}
            {msg.media_type === "image" && msg.media_url && (
              <div className="relative group">
                <img
                  src={msg.media_url}
                  className="w-full h-auto max-h-[400px] object-cover block cursor-pointer"
                  onClick={() => setViewingImage(msg.media_url)}
                  loading="lazy"
                  alt=""
                />
              </div>
            )}
            {msg.media_type === "audio" && msg.media_url && (
              <AudioPlayer src={msg.media_url} isMine={isMine} />
            )}
            {isLoc && (
              <div
                className="p-3 bg-white/5 flex items-center gap-3 active:bg-white/10 transition-colors cursor-pointer"
                onClick={() => {
                  const { lat, lng } = parseLocation(msg.content);
                  openInNativeMaps(lat, lng, msg.content);
                }}
              >
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                  <MapPin size={20} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-bold block">
                    Current Location
                  </span>
                  <span className="text-[11px] opacity-40 block truncate">
                    Tap to open maps
                  </span>
                </div>
              </div>
            )}
            {isCall && (
              <div className={cn(
                "p-3 flex items-center gap-3 rounded-[20px] select-none font-sans min-w-[160px]",
                isMine 
                  ? "bg-white text-black"
                  : "bg-[#141414] text-white border border-white/5"
              )}>
                <div className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                  isMine ? "bg-black/10 text-black" : "bg-white/10 text-white"
                )}>
                  {msg.media_type === "call_audio" ? <Phone size={16} /> : <Video size={16} />}
                </div>
                <div className="flex-1 min-w-0 pr-1">
                  <span className="text-[13px] font-bold block leading-tight font-sans">
                    {msg.media_type === "call_audio" ? 'Audio Call' : 'Video Call'}
                  </span>
                  <span className={cn(
                    "text-[10px] block mt-0.5 leading-none font-mono tracking-wider",
                    isMine ? "text-black/60" : "text-white/40"
                  )}>
                    {isMine ? 'OUTGOING' : 'INCOMING'}
                  </span>
                </div>
              </div>
            )}
            {msg.content && !isMediaOnly && (
              <div className={cn("px-1", isMine ? "text-black" : "text-white")}>
                <Linkify text={msg.content} />
              </div>
            )}
          </motion.div>
        </div>
      </div>
      </div>
    );
  }
);
