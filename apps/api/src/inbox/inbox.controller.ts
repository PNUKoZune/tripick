import { Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserEntity } from '../users/user.entity';
import { InboxService } from './inbox.service';

@ApiTags('Inbox')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inbox')
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  @Get()
  @ApiOperation({ summary: '인박스 목록 (알림 + 친구 요청)' })
  list(@CurrentUser() user: UserEntity) {
    return this.inboxService.list(user);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: '알림 읽음 처리' })
  markRead(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.inboxService.markRead(user, id);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: '모든 알림 읽음 처리' })
  markAllRead(@CurrentUser() user: UserEntity) {
    return this.inboxService.markAllRead(user);
  }
}
