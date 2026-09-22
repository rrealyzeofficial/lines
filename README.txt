REALYZE LINES — SETUP
=====================

1) Dùng ĐÚNG Supabase project của REALYZE Team Space.
2) Mở Supabase > SQL Editor và chạy:
   sql/lyric_distribution.sql
3) Mở supabase-config.js và chép 2 giá trị từ Team Space cũ:
   REALYZE_SUPABASE_URL
   REALYZE_SUPABASE_PUBLISHABLE_KEY
4) Đưa toàn bộ file lên hosting/GitHub Pages hoặc chạy localhost.
5) Đăng nhập bằng tài khoản Team Space hiện tại.

LUỒNG:
- login.html: đăng nhập Supabase Auth, kiểm tra auth_user_id trong team_members.
- index.html: sảnh.
- playlist.html: playlist + popup tạo bài.
- distribute.html?id=...: bảng chia line, multi-member, All, thống kê.
- song.html?id=...: bản lời hoàn chỉnh, audio và lọc theo member.

DỮ LIỆU MEMBER:
- team_members: slug, display_name, color, auth_user_id, is_active...
- team_member_profiles: stage_name, profile_color, avatar_path...
Web không hardcode roster.

STORAGE MỚI:
- lyric-song-covers (private)
- lyric-song-audio (private)

LƯU Ý:
- SQL dựa vào public.is_team_member() đã có từ Team Space.
- Mỗi line có thể tick nhiều member.
- Tick All sẽ xóa lựa chọn member của line đó; tick member sẽ bỏ All.
