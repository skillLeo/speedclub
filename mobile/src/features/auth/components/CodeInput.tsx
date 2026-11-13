/**
 * The 6-digit code field of the auth and settings screens (AUTH-05, AUTH-07, AUTH-11, AUTH-13, AUTH-16, SET-03/05): the OTPInput
 * of the design system (09 §5) at the code length of the server.
 */
import { OTPInput, OTPInputSkeleton, type OTPInputProps } from '@/ui/OTPInput';

import { CODE_LENGTH } from '../schemas';

/** The six cells as skeleton blocks, for the loading state of the screens around it. */
export function CodeInputSkeleton() {
  return <OTPInputSkeleton length={CODE_LENGTH} />;
}

export type CodeInputProps = Omit<OTPInputProps, 'length'>;

export function CodeInput(props: CodeInputProps) {
  return <OTPInput {...props} length={CODE_LENGTH} />;
}
