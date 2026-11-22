import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import * as m from "motion/react-m";
import { X } from "lucide-react";
import type { ReactNode } from "react";
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return createPortal(
    <m.dialog
      ref={dialog}
      className="modal"
      initial={{ y: 42 }}
      animate={{ y: 0 }}
      exit={{ opacity: 0, y: 28 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="modal-header">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={21} />
        </button>
      </header>
      <div className="modal-inner">
        {children}
      </div>
    </m.dialog>, document.body
  );
}
