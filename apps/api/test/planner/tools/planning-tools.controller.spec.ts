/// <reference types="jest" />

import { EventEmitter } from 'node:events';
import {
  UnauthorizedException,
  ValidationPipe,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../../src/auth/guards/jwt-auth.guard';
import { PlanningToolsController } from '../../../src/planner/tools/planning-tools.controller';
import { PlanningToolsService } from '../../../src/planner/tools/planning-tools.service';
import type { UserEntity } from '../../../src/users/user.entity';

const TRIP_ID = 'b27306f4-b92f-4987-9cf2-59d763704cdf';
const draft = {
  snapshotId: 'd2b72d15-aae6-4784-a804-7db2f4d4d215',
  snapshotVersion: 'a'.repeat(64),
};

describe('PlanningToolsController HTTP contract', () => {
  let app: INestApplication;
  const tools = {
    getContext: jest.fn(),
    validate: jest.fn(),
    evaluate: jest.fn(),
    optimize: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PlanningToolsController],
      providers: [{ provide: PlanningToolsService, useValue: tools }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<Request>();
          const owner = req.headers['x-test-owner'];
          if (!owner) throw new UnauthorizedException();
          Object.assign(req, { user: { id: owner } });
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    tools.getContext.mockResolvedValue({ operation: 'context' });
    tools.validate.mockResolvedValue({ operation: 'validate' });
    tools.evaluate.mockResolvedValue({ operation: 'evaluate' });
    tools.optimize.mockResolvedValue({ operation: 'optimize' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires authentication before accessing planning context', async () => {
    await request(app.getHttpServer())
      .post(`/trips/${TRIP_ID}/planning/context`)
      .send({})
      .expect(401);
    expect(tools.getContext).not.toHaveBeenCalled();
  });

  it('takes the authenticated owner from the request and rejects forged owner fields', async () => {
    await request(app.getHttpServer())
      .post(`/trips/${TRIP_ID}/planning/context`)
      .set('x-test-owner', 'owner')
      .send({})
      .expect(200);
    expect(tools.getContext).toHaveBeenCalledWith('owner', TRIP_ID, expect.any(Object));
    tools.getContext.mockClear();
    await request(app.getHttpServer())
      .post(`/trips/${TRIP_ID}/planning/context`)
      .set('x-test-owner', 'owner')
      .send({ ownerId: 'forged-owner' })
      .expect(400);
    expect(tools.getContext).not.toHaveBeenCalled();
  });

  it('validates trip UUIDs before calling the service', async () => {
    await request(app.getHttpServer())
      .post('/trips/not-a-uuid/planning/context')
      .set('x-test-owner', 'owner')
      .send({})
      .expect(400);
    expect(tools.getContext).not.toHaveBeenCalled();
  });

  it.each(['validate', 'evaluate', 'optimize'] as const)(
    'routes %s through its DTO and authenticated owner',
    async (operation) => {
      await request(app.getHttpServer())
        .post(`/trips/${TRIP_ID}/planning/${operation}`)
        .set('x-test-owner', 'owner')
        .send(draft)
        .expect(200);
      if (operation === 'optimize') {
        expect(tools.optimize).toHaveBeenCalledWith(
          'owner',
          TRIP_ID,
          expect.objectContaining(draft),
          expect.any(AbortSignal),
        );
      } else {
        expect(tools[operation]).toHaveBeenCalledWith(
          'owner',
          TRIP_ID,
          expect.objectContaining(draft),
        );
      }
    },
  );

  it('runs nested placement validation before service execution', async () => {
    await request(app.getHttpServer())
      .post(`/trips/${TRIP_ID}/planning/validate`)
      .set('x-test-owner', 'owner')
      .send({
        ...draft,
        items: [{ id: 'candidate', day: 1, order: 1, scheduledAt: 'invalid', durationMin: -1 }],
      })
      .expect(400);
    expect(tools.validate).not.toHaveBeenCalled();
  });

  it('enforces optimization bounds before starting a calculation', async () => {
    await request(app.getHttpServer())
      .post(`/trips/${TRIP_ID}/planning/optimize`)
      .set('x-test-owner', 'owner')
      .send({ ...draft, maxEvaluations: 51 })
      .expect(400);
    expect(tools.optimize).not.toHaveBeenCalled();
  });
});

describe('PlanningToolsController cancellation', () => {
  it('propagates client abort and removes its listener after completion', async () => {
    let signal: AbortSignal | undefined;
    let complete!: (value: unknown) => void;
    const tools = {
      optimize: jest.fn((_user, _trip, _body, nextSignal: AbortSignal) => {
        signal = nextSignal;
        return new Promise((resolve) => {
          complete = resolve;
        });
      }),
    };
    const controller = new PlanningToolsController(tools as unknown as PlanningToolsService);
    const req = new EventEmitter();
    const pending = controller.optimize(
      { id: 'owner' } as UserEntity,
      TRIP_ID,
      draft,
      req as unknown as Request,
    );
    expect(signal?.aborted).toBe(false);
    req.emit('aborted');
    expect(signal?.aborted).toBe(true);
    complete({ terminationReason: 'CANCELLED' });
    await pending;
    expect(req.listenerCount('aborted')).toBe(0);
  });

  it('removes its abort listener when the service throws', async () => {
    const tools = { optimize: jest.fn().mockRejectedValue(new Error('calculation failed')) };
    const controller = new PlanningToolsController(tools as unknown as PlanningToolsService);
    const req = new EventEmitter();
    await expect(
      controller.optimize({ id: 'owner' } as UserEntity, TRIP_ID, draft, req as unknown as Request),
    ).rejects.toThrow('calculation failed');
    expect(req.listenerCount('aborted')).toBe(0);
  });
});
