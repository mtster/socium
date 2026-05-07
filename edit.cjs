const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

// We just replace the motion.div and its contents dynamically using regex
const regex1 = /\{viewingProfileId !== null && \([\s\S]*?className="absolute inset-0 z-\[100\] bg-black overflow-y-auto"/g;
const repl1 = `{viewingProfileId !== null && (
           <motion.div 
             key="other_profile" 
             initial={{ opacity: 0, x: '100%' }} 
             animate={{ opacity: 1, x: 0 }} 
             exit={{ opacity: 0, x: '100%' }}
             transition={{ type: "tween", duration: 0.3 }}
             className="absolute top-0 left-0 right-0 z-[60] bg-black overflow-y-auto"
             style={{ bottom: 'calc(60px + env(safe-area-inset-bottom))' }}`;

const regex2 = /<div className="sticky top-0 left-0 w-full px-4 h-14 flex items-center bg-black\/90 backdrop-blur-md z-50 border-b border-white\/10 pt-\[env\(safe-area-inset-top\)\]">[\s\S]*?<\/div>/g;
const repl2 = `<div 
               className="absolute left-2 z-[60]"
               style={{ top: 'calc(12px + env(safe-area-inset-top))' }}
             >
               <button 
                 onClick={() => setViewingProfileId(null)} 
                 className="p-3 bg-black/40 backdrop-blur-md rounded-full text-white/90 active:scale-95 transition-transform"
               >
                 <ArrowLeft size={20} opacity={0.8} />
               </button>
             </div>`;

const regex3 = /<div className="absolute top-0 left-0 w-full px-4 h-14 flex items-center pt-\[env\(safe-area-inset-top\)\]">[\s\S]*?<\/div>/g;

content = content.replace(regex1, repl1)
                 .replace(regex2, repl2)
                 .replace(regex3, "");

// we need to move the </main> tag.
// remove it from where it is (`</AnimatePresence>\n      </main>`)
content = content.replace(/<\/AnimatePresence>\n      <\/main>/, "</AnimatePresence>");

// add `</main>` before `{/* Overlay for Other Profile */}`
content = content.replace(/{[\s\n]*\/\* Overlay for Other Profile \*\//g, "</main>\n\n      {/* Overlay for Other Profile */}");

fs.writeFileSync('src/App.tsx', content, 'utf8');
console.log('Success regex replacement');
