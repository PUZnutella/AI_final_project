'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import ChatRoom from '../../ChatRoom';
import { toast } from 'react-hot-toast';
import GameContent from '../../GameContent';
import { MAX_PLAYER } from '../../lib/config';
// 遊戲狀態
type GameStatus = 'waiting' | 'introduction' | 'selecting_roles' | 'investigation1' | 'discussion1' |  'investigation2' | 'discussion2' | 'voting' | 'ended';

interface Player {
  id: string;
  room_id: string;
  name: string;
  is_host: boolean;
  role_id: string;
}

interface GameRole {
  id: string;
  script_id: string;
  name: string;
  public_info: string;
  secret: string;
  mission: string;
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const codeParam = params.code as string;

  const [room, setRoom] = useState<any>(null);
  const [player, setPlayer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [roles, setRoles] = useState<GameRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);



  // 載入房間和玩家資訊
  useEffect(() => {
    if (!codeParam) return;

    // 從 localStorage 獲取玩家 ID
    const savedPlayerId = localStorage.getItem(`player_id_${codeParam}`);
    console.log('從 localStorage 獲取玩家 ID:', savedPlayerId);

    async function fetchRoomAndPlayer() {
      setLoading(true);

      try {
        // 获取房间信息
        const { data: room, error: roomErr } = await supabase
          .from('room')
          .select('*')
          .eq('room_code', parseInt(codeParam, 10))
          .single();

        if (roomErr || !room) {
          setError('找不到該房間');
          setLoading(false);
          return;
        }

        setRoom(room);

        // 获取当前房间的所有玩家
        const { data: allPlayers } = await supabase
          .from('player')
          .select('room_id, id, name, role_id, is_host')
          .eq('room_id', room.id);

        // 如果有保存的玩家ID，尋找對應玩家
        if (savedPlayerId && allPlayers) {
          const savedPlayer = allPlayers.find(p => p.id === savedPlayerId);
          if (savedPlayer) {
            console.log('找到已保存的玩家:', savedPlayer.name);
            setPlayer(savedPlayer);
            setPlayers(allPlayers);
            setLoading(false);
            return;
          }
        }

        // 如果找不到保存的玩家ID或對應玩家不存在，創建新玩家
        console.log('找不到已保存的玩家，創建新玩家');
        
        // 获取昵称（优先使用自定义昵称，如果没有则使用随机编号）
        const customName = localStorage.getItem('user_name');
        
        // 生成随机4位数字
        const generateRandomNumber = () => {
          return Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        };

        // 获取已使用的编号
        const usedNumbers = allPlayers
          ? allPlayers
              .map(p => p.name.match(/玩家(\d{4})/)?.[1])
              .filter(Boolean)
          : [];

        // 生成未使用的随机编号
        let randomNumber;
        do {
          randomNumber = generateRandomNumber();
        } while (usedNumbers.includes(randomNumber));

        const defaultName = `玩家${randomNumber}`;
        const finalName = customName || defaultName;
        
        // 创建新玩家（不需要提供id，数据库会自动生成）
        const isHost = !allPlayers || allPlayers.length === 0;
        console.log('準備創建新玩家，房間ID:', room.id, '暱稱:', finalName, '是否為房主:', isHost);
        
        try {
          const { data: newPlayer, error: createErr } = await supabase
            .from('player')
            .insert([
              {
                room_id: room.id,
                name: finalName,
                is_host: isHost,
                role_id: null
              }
            ])
            .select()
            .single();

          if (createErr) {
            console.error('创建玩家失败，錯誤詳情:', createErr);
            setError('創建玩家失敗: ' + createErr.message);
            setLoading(false);
            return;
          }

          if (!newPlayer) {
            console.error('创建玩家失败: 未返回玩家數據');
            setError('創建玩家失敗: 未返回玩家數據');
            setLoading(false);
            return;
          }

          console.log('成功创建新玩家:', newPlayer);
          
          // 保存玩家ID到localStorage
          localStorage.setItem(`player_id_${codeParam}`, newPlayer.id);
          localStorage.setItem(`player_created_${codeParam}`, 'true');

          // 如果是房主，更新房间的创建者ID
          if (isHost) {
            const { error: updateRoomErr } = await supabase
              .from('room')
              .update({ host_id: newPlayer.id })
              .eq('id', room.id);

            if (updateRoomErr) {
              console.error('更新房间创建者失败:', updateRoomErr);
            }
          }

          setPlayer(newPlayer);
          setPlayers(allPlayers ? [...allPlayers, newPlayer] : [newPlayer]);
        } catch (insertError) {
          console.error('創建玩家時發生異常:', insertError);
          setError('創建玩家時發生異常: ' + (insertError instanceof Error ? insertError.message : '未知錯誤'));
          setLoading(false);
          return;
        }

        setError('');
      } catch (error) {
        console.error('加载房间和玩家信息失败:', error);
        setError('加載失敗');
      } finally {
        setLoading(false);
      }
    }

    fetchRoomAndPlayer();
  }, [codeParam]); // 只依赖codeParam，避免重复执行

  // 載入並訂閱玩家列表（channel API）
  useEffect(() => {
    if (!room) return;

    async function loadPlayers() {
      try {
        const { data, error } = await supabase
          .from('player')
          .select('id, room_id, name, role_id, is_host')
          .eq('room_id', room.id);
          
        if (error) {
          console.error('加载玩家列表失败:', error);
          return;
        }
        
        if (data) {
          const currentPlayerInList = player ? data.some(p => p.id === player.id) : false;
  
          const validPlayers = data.map(p => ({
            id: p.id,
            room_id: p.room_id,
            name: p.name,
            role_id: p.role_id || '',
            is_host: p.is_host
          }));
  
          setPlayers(validPlayers);
  
          if (player && !currentPlayerInList) {
            setError('你的玩家資料已被刪除，請返回主頁面重新加入房間');
          }
        }
      } catch (err) {
        console.error('加载玩家列表时出错:', err);
      }
    }

    // 创建实时订阅
    const playerChannel = supabase
    .channel(`player-room-${room.id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'player', filter: `room_id=eq.${room.id}` },
      (payload) => {
        console.log('玩家變更:', payload);
        loadPlayers();
      }
    )
    .subscribe();

  loadPlayers();

  return () => {
    supabase.removeChannel(playerChannel);
  };
}, [room, player]);

  // 處理玩家離開房間 - 只在瀏覽器關閉時執行
  useEffect(() => {
    // 只在真正離開頁面時執行清理
    const handleBeforeUnload = () => {
      if (player && room) {
        console.log('頁面即將關閉，發送離開請求:', player.id);
        
        // 使用同步請求確保在頁面卸載前發送
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/leave-room', false); // 同步請求
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({
          playerId: player.id,
          roomId: room.id,
          isHost: player.is_host
        }));
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // 不再自動刪除玩家，避免在頁面重新渲染時誤刪
    };
  }, [player, room]);

  // 手動離開房間
  const leaveRoom = async () => {
    if (player && room) {
      console.log('手動離開房間:', player.id);
      
      // 删除玩家记录
      await supabase
        .from('player')
        .delete()
        .eq('id', player.id);

      // 如果房主离开，删除房间
      if (player.is_host) {
        // 刪除房間前，清除該房間相關的localStorage記錄
        localStorage.removeItem(`player_id_${codeParam}`);
        
        await supabase
          .from('room')
          .delete()
          .eq('id', room.id);
      }
      
      // 導航回主頁
      router.push('/');
    }
  };
  // 假設有訂閱或 useEffect 更新 room.status
  useEffect(() => {
    if (room) {
      setGameStatus(room.status);
    }
  }, [room]);
  
  // 訂閱房間狀態變化
  useEffect(() => {
    if (!room) return;
  
    const roomChannel = supabase
      .channel(`room-${room.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'room', filter: `id=eq.${room.id}` },
        (payload) => {
          const updatedRoom = payload.new as any;
          setRoom(updatedRoom);
          setGameStatus(updatedRoom.status as GameStatus);
        }
      )
      .subscribe();
  
    return () => {
      supabase.removeChannel(roomChannel);
    };
  }, [room?.id]);

  if (loading) return <p className="p-6 text-center">載入中...</p>;
  if (error) return <p className="p-6 text-center text-red-600">{error}</p>;
  if (!room || !player) return null;


  const handleStartGame = async () => {
    try {
      // 更新後端房間狀態為 introduction
      const { error } = await supabase
        .from('room')
        .update({ status: 'introduction' })
        .eq('id', room.id);
  
      if (error) {
        console.error('無法開始遊戲:', error.message);
        toast.error('無法開始遊戲');
        return;
      }
  
      // 更新前端狀態
      setGameStatus('introduction');
      toast.success('已開始遊戲！');
    } catch (err) {
      console.error('開始遊戲時發生錯誤:', err);
      toast.error('發生錯誤，請重試');
    }
  };

  return (
    <main className="max-w-xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-1">房間代碼：{room.room_code}</h2>
      <p className="text-gray-600 text-sm mb-4">你的名稱：{player.name}</p>
      {/* <p>狀態：{room.status}</p> */}
      <div className="bg-gray-100 px-3 py-2 rounded mb-4">
        <p className="font-medium">
          人數：{players.length} / {MAX_PLAYER}
        </p>
      </div>

      {/* 房主控制面板 */}
      {player.is_host && room.status === 'waiting' && (
        <div className="mt-4 p-4 border rounded bg-gray-50">
          <h3 className="text-lg font-semibold mb-2">房主控制面板</h3>
          <button
            onClick={handleStartGame}
            disabled={players.length < 1}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            開始遊戲
          </button>
          {players.length < 1 && (
            <p className="text-sm text-red-600 mt-2">需要至少1名玩家才能開始遊戲</p>
          )}
        </div>
      )}


      {/* 遊戲內容 */}
      {room.status !== 'waiting'&& (
        <GameContent
          roomId={room.id}
          playerId={player.id}
          playerRole={player.role}
        />
      )}

      {/* 聊天室 */}
      <div className="mt-6 border rounded bg-white shadow">
        <ChatRoom
        roomId={room.id}
        playerId={player?.id ?? ''}
        players={players}
        setPlayers={setPlayers}
      />
      </div>
       {/* 離開房間按鈕 */}
       <br></br>
       <button
        onClick={() => {
          const confirmLeave = window.confirm("確定要離開嗎？");
          if (confirmLeave) {
            leaveRoom();
          }
        }}
        className="mb-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
      >
        離開房間
      </button>
    </main>
  );
}
