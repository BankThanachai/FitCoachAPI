import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrainerCourseDto } from './dto/create-trainer-course.dto';
import { UpdateTrainerCourseDto } from './dto/update-trainer-course.dto';

@Injectable()
export class TrainerCoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    trainerId: string,
    createTrainerCourseDto: CreateTrainerCourseDto,
  ) {
    const trainer = await this.prisma.user.findUnique({
      where: { id: trainerId },
    });
    if (!trainer) {
      throw new NotFoundException('Trainer not found');
    }
    if (trainer.type !== UserType.Trainer) {
      throw new BadRequestException('Only trainers can create courses');
    }

    return this.prisma.trainerCourse.create({
      data: { ...createTrainerCourseDto, trainerId },
    });
  }

  async findByTrainer(trainerId: string) {
    return this.prisma.trainerCourse.findMany({
      where: { trainerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const course = await this.prisma.trainerCourse.findUnique({
      where: { id },
    });
    if (!course) {
      throw new NotFoundException(`Trainer course with id ${id} not found`);
    }
    return course;
  }

  private async ensureOwnedByTrainer(trainerId: string, id: string) {
    const course = await this.prisma.trainerCourse.findFirst({
      where: { id, trainerId },
    });
    if (!course) {
      throw new NotFoundException(`Trainer course with id ${id} not found`);
    }
  }

  async update(
    trainerId: string,
    id: string,
    updateTrainerCourseDto: UpdateTrainerCourseDto,
  ) {
    await this.ensureOwnedByTrainer(trainerId, id);
    return this.prisma.trainerCourse.update({
      where: { id },
      data: updateTrainerCourseDto,
    });
  }

  async remove(trainerId: string, id: string) {
    await this.ensureOwnedByTrainer(trainerId, id);
    return this.prisma.trainerCourse.delete({ where: { id } });
  }
}
