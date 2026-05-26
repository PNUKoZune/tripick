import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AddFriendRequestDto } from '@tripick/types';
import {
  FRIENDS_MOCK,
  acceptFriendMock,
  addFriendMock,
  removeFriendMock,
  togglePinFriendMock,
} from './friends.mock';

/**
 * v1 카카오톡 친구 목록 톤의 mock 컨트롤러.
 * 인증/DB 없이 in-memory 배열만 다룬다.
 */
@ApiTags('Friends (Mock v1)')
@Controller('friends')
export class FriendsController {
  @Get()
  @ApiOperation({ summary: '내 친구 목록 mock' })
  list() {
    return FRIENDS_MOCK;
  }

  @Post()
  @ApiOperation({ summary: '친구 추가 요청 mock (handle 로 검색)' })
  add(@Body() dto: AddFriendRequestDto) {
    if (!dto?.handle?.trim()) {
      throw new BadRequestException('카카오 ID를 입력해주세요.');
    }
    return addFriendMock(dto.handle.trim());
  }

  @Patch(':id/accept')
  @ApiOperation({ summary: '받은 친구 요청 수락 mock' })
  accept(@Param('id') id: string) {
    const friend = acceptFriendMock(id);
    if (!friend) {
      throw new NotFoundException('friend not found');
    }
    return friend;
  }

  @Patch(':id/pin')
  @ApiOperation({ summary: '친구 즐겨찾기 토글 mock' })
  togglePin(@Param('id') id: string) {
    const friend = togglePinFriendMock(id);
    if (!friend) {
      throw new NotFoundException('friend not found');
    }
    return friend;
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '친구 삭제 mock' })
  remove(@Param('id') id: string) {
    const ok = removeFriendMock(id);
    if (!ok) {
      throw new NotFoundException('friend not found');
    }
  }
}
