import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { WorkoutStatus } from '../../../generated/prisma/client';
import { FindTrainerWorkoutsDto } from './find-trainer-workouts.dto';

// Same options as main.ts, so this exercises the real 400 behaviour.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function parse(query: Record<string, unknown>) {
  return pipe.transform(query, {
    type: 'query',
    metatype: FindTrainerWorkoutsDto,
  }) as Promise<FindTrainerWorkoutsDto>;
}

describe('FindTrainerWorkoutsDto — status query', () => {
  it('accepts a comma-separated list', async () => {
    const dto = await parse({
      status: 'PendingApproval,TrainerApproved,TrainerSubmitted',
    });
    expect(dto.status).toEqual([
      WorkoutStatus.PendingApproval,
      WorkoutStatus.TrainerApproved,
      WorkoutStatus.TrainerSubmitted,
    ]);
  });

  it('accepts repeated params (arrives as an array)', async () => {
    const dto = await parse({
      status: [WorkoutStatus.PendingApproval, WorkoutStatus.TrainerApproved],
    });
    expect(dto.status).toEqual([
      WorkoutStatus.PendingApproval,
      WorkoutStatus.TrainerApproved,
    ]);
  });

  it('accepts a mix of repeated params and commas', async () => {
    const dto = await parse({
      status: ['PendingApproval,TrainerApproved', 'TrainerSubmitted'],
    });
    expect(dto.status).toEqual([
      WorkoutStatus.PendingApproval,
      WorkoutStatus.TrainerApproved,
      WorkoutStatus.TrainerSubmitted,
    ]);
  });

  it('still accepts a single value (backward compatible)', async () => {
    const dto = await parse({ status: 'PendingApproval' });
    expect(dto.status).toEqual([WorkoutStatus.PendingApproval]);
  });

  it('tolerates whitespace around comma-separated values', async () => {
    const dto = await parse({ status: 'PendingApproval, TrainerApproved' });
    expect(dto.status).toEqual([
      WorkoutStatus.PendingApproval,
      WorkoutStatus.TrainerApproved,
    ]);
  });

  it('leaves status undefined when omitted', async () => {
    const dto = await parse({});
    expect(dto.status).toBeUndefined();
  });

  it('rejects a value that is not a WorkoutStatus with 400', async () => {
    await expect(parse({ status: 'Nope' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects the whole list if any one value is invalid', async () => {
    await expect(
      parse({ status: 'PendingApproval,Nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parse({ status: ['PendingApproval', 'Nope'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty value or empty segment with 400', async () => {
    await expect(parse({ status: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(parse({ status: 'PendingApproval,' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not disturb the other filters', async () => {
    const dto = await parse({
      status: 'PendingApproval,TrainerApproved',
      date: '2026-10-03',
      clientName: 'ann',
      page: '2',
      pageSize: '10',
    });
    expect(dto).toMatchObject({
      date: '2026-10-03',
      clientName: 'ann',
      page: 2,
      pageSize: 10,
    });
  });
});
