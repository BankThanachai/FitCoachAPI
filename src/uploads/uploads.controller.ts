import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { ConfirmPortfolioPhotoDto } from './dto/confirm-portfolio-photo.dto';
import { ConfirmProfilePhotoDto } from './dto/confirm-profile-photo.dto';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { UploadsService } from './uploads.service';

@Controller({ version: '1' })
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('users/me/profile-photo/presign')
  presignProfilePhoto(
    @Req() request: Request & { user: JwtPayload },
    @Body() presignUploadDto: PresignUploadDto,
  ) {
    return this.uploadsService.presignProfilePhoto(
      request.user.sub,
      presignUploadDto,
    );
  }

  @Post('users/me/profile-photo/confirm')
  confirmProfilePhoto(
    @Req() request: Request & { user: JwtPayload },
    @Body() confirmProfilePhotoDto: ConfirmProfilePhotoDto,
  ) {
    return this.uploadsService.confirmProfilePhoto(
      request.user.sub,
      confirmProfilePhotoDto,
    );
  }

  @Post('users/me/portfolio-photos/presign')
  presignPortfolioPhoto(
    @Req() request: Request & { user: JwtPayload },
    @Body() presignUploadDto: PresignUploadDto,
  ) {
    return this.uploadsService.presignPortfolioPhoto(
      request.user.sub,
      presignUploadDto,
    );
  }

  @Post('users/me/portfolio-photos/confirm')
  confirmPortfolioPhoto(
    @Req() request: Request & { user: JwtPayload },
    @Body() confirmPortfolioPhotoDto: ConfirmPortfolioPhotoDto,
  ) {
    return this.uploadsService.confirmPortfolioPhoto(
      request.user.sub,
      confirmPortfolioPhotoDto,
    );
  }

  @Get('trainers/:trainerId/portfolio-photos')
  findPortfolioPhotos(@Param('trainerId') trainerId: string) {
    return this.uploadsService.findPortfolioPhotos(trainerId);
  }

  @Delete('users/me/portfolio-photos/:id')
  removePortfolioPhoto(
    @Req() request: Request & { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.uploadsService.removePortfolioPhoto(request.user.sub, id);
  }
}
