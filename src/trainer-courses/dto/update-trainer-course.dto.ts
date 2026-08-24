import { PartialType } from '@nestjs/mapped-types';
import { CreateTrainerCourseDto } from './create-trainer-course.dto';

export class UpdateTrainerCourseDto extends PartialType(
  CreateTrainerCourseDto,
) {}
