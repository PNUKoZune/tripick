import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserEntity } from '../users/user.entity';
import { PreferencesService } from './preferences.service';
import { UpdatePreferenceBodyDto } from './dto/preference.dto';

@ApiTags('Preferences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  @Get()
  @ApiOperation({ summary: '내 취향 설정 조회' })
  getMyPreferences(@CurrentUser() user: UserEntity) {
    return this.preferencesService.findByUser(user.id);
  }

  @Put()
  @ApiOperation({ summary: '취향 설정 저장/갱신' })
  upsertPreferences(@CurrentUser() user: UserEntity, @Body() dto: UpdatePreferenceBodyDto) {
    return this.preferencesService.upsert(user.id, dto);
  }
}
