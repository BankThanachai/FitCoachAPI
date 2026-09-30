import { IsOptional, IsString } from 'class-validator';

export class LoginDto {
  // Either a Thai phone number (0XXXXXXXXX) or an email — resolved to the
  // matching column server-side (AuthService.resolveIdentifier). A single
  // field lets the client offer one "phone or email" input rather than
  // asking the user to pick which they're typing.
  @IsString()
  identifier: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  fcmToken?: string;
}
