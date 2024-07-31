import { Test, TestingModule } from '@nestjs/testing';
import { NerService } from './ner.service';

describe('NerService', () => {
  let service: NerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NerService],
    }).compile();

    service = module.get<NerService>(NerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
