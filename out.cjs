// script.js
var fs = require("fs");
var content = fs.readFileSync("src/components/Chat.tsx", "utf8");
content = content.replace(
  /<div className="flex flex-col-reverse">[\s\S]*?{messages\.slice\(\)\.reverse\(\)\.map\(\(msg, idx, arr\) => \([\s\S]*?<motion\.div[^>]*>[\s\S]*?<MessageBubble[^>]*\/>[\s\S]*?<\/div>[\s\S]*?\)\)}[\s\S]*?<\/div>/,
  `<div className="flex flex-col-reverse">
                  <AnimatePresence initial={false}>
                  {messages.slice().reverse().map((msg, idx, arr) => (
                     <motion.div key={msg.id} layout initial={{ opacity: 0, scale: 0.95, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
                        <MessageBubble msg={msg} isMine={msg.sender_id === currentUserId} nextMsg={arr[idx - 1]} prevMsg={arr[idx + 1]} activeChat={activeChat} currentUserId={currentUserId} setViewingImage={setViewingImage} handleLongPress={handleLongPress} contextMenu={contextMenu} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onCloseChat={onCloseChat} />
                     </motion.div>
                   ))}
                  </AnimatePresence>
                </div>`
);
fs.writeFileSync("src/components/Chat.tsx", content);
