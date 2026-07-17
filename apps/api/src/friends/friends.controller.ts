import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserEntity } from '../users/user.entity';
import { FriendsService } from './friends.service';
import { AddFriendRequestBodyDto } from './dto/friend.dto';

@ApiTags('Friends')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  @ApiOperation({ summary: '내 친구 목록' })
  list(@CurrentUser() user: UserEntity) {
    return this.friendsService.list(user.id);
  }

  @Post()
  @ApiOperation({ summary: '친구 추가 또는 요청 생성' })
  add(@CurrentUser() user: UserEntity, @Body() dto: AddFriendRequestBodyDto) {
    return this.friendsService.add(user, dto);
  }

  @Patch(':id/accept')
  @ApiOperation({ summary: '받은 친구 요청 수락' })
  accept(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.friendsService.accept(user.id, id);
  }

  @Patch(':id/pin')
  @ApiOperation({ summary: '친구 즐겨찾기 토글' })
  togglePin(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.friendsService.togglePin(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '친구 삭제' })
  remove(@CurrentUser() user: UserEntity, @Param('id') id: string) {
    return this.friendsService.remove(user.id, id);
  }
}
