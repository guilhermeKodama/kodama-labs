'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AttachmentUploader,
  type AttachmentKind,
  type AttachmentOwnerType,
} from '@/components/attachments/attachment-uploader';

export interface AttachmentsDialogSection {
  kind: AttachmentKind;
  label: string;
  helperText?: string;
}

interface AttachmentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerType: AttachmentOwnerType;
  ownerId: string | null;
  title: string;
  description?: string;
  sections: AttachmentsDialogSection[];
}

export function AttachmentsDialog({
  open,
  onOpenChange,
  ownerType,
  ownerId,
  title,
  description,
  sections,
}: AttachmentsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-slate-400">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {ownerId ? (
          <div className="space-y-4">
            {sections.map((section) => (
              <AttachmentUploader
                key={section.kind}
                ownerType={ownerType}
                ownerId={ownerId}
                kind={section.kind}
                label={section.label}
                helperText={section.helperText}
              />
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
